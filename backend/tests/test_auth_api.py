"""
Integration tests for the authentication API.

Exercises the full login flow via FastAPI TestClient:
  1. POST /auth/login (password) → partial_token
  2. POST /auth/login/2fa (TOTP) → access + refresh tokens
  3. GET /auth/me (protected) → user info
  4. POST /auth/refresh → new access token
  5. POST /auth/logout → token revoked
  6. Error paths: wrong password, wrong TOTP, expired partial token,
     account lockout, protected route without token
"""
import pyotp
import pytest


class TestLoginFlow:
    def test_login_returns_partial_token(self, client, test_user):
        r = client.post("/api/v1/auth/login", json={
            "username": test_user["username"],
            "password": test_user["password"],
        })
        assert r.status_code == 200
        body = r.json()
        assert body["requires_2fa"] is True
        assert "partial_token" in body
        assert len(body["partial_token"]) > 10

    def test_login_wrong_password_returns_401(self, client, test_user):
        r = client.post("/api/v1/auth/login", json={
            "username": test_user["username"],
            "password": "WrongPassword99!",
        })
        assert r.status_code == 401

    def test_login_nonexistent_user_returns_401(self, client):
        r = client.post("/api/v1/auth/login", json={
            "username": "ghost_user_xyz",
            "password": "SomePassword1!",
        })
        assert r.status_code == 401

    def test_2fa_with_valid_totp_returns_tokens(self, client, test_user):
        # Step 1
        r1 = client.post("/api/v1/auth/login", json={
            "username": test_user["username"],
            "password": test_user["password"],
        })
        partial = r1.json()["partial_token"]

        # Step 2
        code = pyotp.TOTP(test_user["totp_secret"]).now()
        r2 = client.post("/api/v1/auth/login/2fa", json={
            "partial_token": partial,
            "code": code,
        })
        assert r2.status_code == 200
        body = r2.json()
        assert "access_token" in body
        assert "refresh_token" in body
        assert body["token_type"] == "bearer"

    def test_2fa_wrong_code_returns_401(self, client, test_user):
        r1 = client.post("/api/v1/auth/login", json={
            "username": test_user["username"],
            "password": test_user["password"],
        })
        partial = r1.json()["partial_token"]

        r2 = client.post("/api/v1/auth/login/2fa", json={
            "partial_token": partial,
            "code": "000000",
        })
        assert r2.status_code == 401

    def test_2fa_invalid_partial_token_returns_401(self, client):
        r = client.post("/api/v1/auth/login/2fa", json={
            "partial_token": "totally-fake-token",
            "code": "123456",
        })
        assert r.status_code == 401

    def test_partial_token_is_single_use(self, client, test_user):
        r1 = client.post("/api/v1/auth/login", json={
            "username": test_user["username"],
            "password": test_user["password"],
        })
        partial = r1.json()["partial_token"]
        code = pyotp.TOTP(test_user["totp_secret"]).now()

        # First use — should succeed
        r2 = client.post("/api/v1/auth/login/2fa", json={"partial_token": partial, "code": code})
        assert r2.status_code == 200

        # Second use of the same partial token — must fail
        r3 = client.post("/api/v1/auth/login/2fa", json={"partial_token": partial, "code": code})
        assert r3.status_code == 401


class TestProtectedRoutes:
    def test_get_me_with_valid_token(self, client, auth_headers, test_user):
        r = client.get("/api/v1/auth/me", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["username"] == test_user["username"]
        assert "id" in body

    def test_get_me_without_token_returns_401(self, client):
        r = client.get("/api/v1/auth/me")
        assert r.status_code == 401

    def test_get_me_with_garbage_token_returns_401(self, client):
        r = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage.token.here"})
        assert r.status_code == 401

    def test_analytics_requires_auth(self, client):
        r = client.get("/api/v1/analytics/overview")
        assert r.status_code == 401


class TestTokenRefresh:
    def test_refresh_returns_new_access_token(self, client, test_user):
        # Full login to get a refresh token
        r1 = client.post("/api/v1/auth/login", json={
            "username": test_user["username"],
            "password": test_user["password"],
        })
        partial = r1.json()["partial_token"]
        code = pyotp.TOTP(test_user["totp_secret"]).now()
        r2 = client.post("/api/v1/auth/login/2fa", json={"partial_token": partial, "code": code})
        refresh_tok = r2.json()["refresh_token"]

        # Use refresh token
        r3 = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_tok})
        assert r3.status_code == 200
        body = r3.json()
        assert "access_token" in body

    def test_invalid_refresh_token_returns_401(self, client):
        r = client.post("/api/v1/auth/refresh", json={"refresh_token": "fake_refresh_token"})
        assert r.status_code == 401


class TestLogout:
    def test_logout_revokes_refresh_token(self, client, test_user):
        # Full login
        r1 = client.post("/api/v1/auth/login", json={
            "username": test_user["username"],
            "password": test_user["password"],
        })
        partial = r1.json()["partial_token"]
        code = pyotp.TOTP(test_user["totp_secret"]).now()
        r2 = client.post("/api/v1/auth/login/2fa", json={"partial_token": partial, "code": code})
        tokens = r2.json()
        access = tokens["access_token"]
        refresh = tokens["refresh_token"]

        # Logout
        r3 = client.post(
            "/api/v1/auth/logout",
            json={"refresh_token": refresh},
            headers={"Authorization": f"Bearer {access}"},
        )
        assert r3.status_code == 200

        # Refresh after logout should fail
        r4 = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
        assert r4.status_code == 401


class TestPasswordChange:
    def test_change_password_succeeds(self, client, auth_headers, test_user):
        r = client.post("/api/v1/auth/change-password", json={
            "current_password": test_user["password"],
            "new_password": "NewStrongPass99!",
        }, headers=auth_headers)
        assert r.status_code == 200

        # Restore original password so other tests still work
        client.post("/api/v1/auth/change-password", json={
            "current_password": "NewStrongPass99!",
            "new_password": test_user["password"],
        }, headers=auth_headers)

    def test_change_password_wrong_current_returns_400(self, client, auth_headers):
        r = client.post("/api/v1/auth/change-password", json={
            "current_password": "TotallyWrong1!",
            "new_password": "NewStrongPass99!",
        }, headers=auth_headers)
        assert r.status_code == 400

    def test_weak_new_password_returns_422(self, client, auth_headers, test_user):
        r = client.post("/api/v1/auth/change-password", json={
            "current_password": test_user["password"],
            "new_password": "short",
        }, headers=auth_headers)
        assert r.status_code == 422


class TestAccountLockout:
    @pytest.mark.asyncio
    async def test_locked_user_gets_429(self, client, sqlite_db):
        """User locked in DB → login attempt returns 429."""
        from api.auth_utils import hash_password
        import db.sqlite_manager as sm
        from datetime import datetime, timedelta, timezone

        username = "locktest_user"
        uid = await sm.create_user(username, hash_password("LockPass1!"),
                                    must_change_password=False)

        # Lock the user by recording 10 failures
        for _ in range(10):
            await sm.record_login_failure(uid)

        r = client.post("/api/v1/auth/login", json={
            "username": username,
            "password": "LockPass1!",
        })
        assert r.status_code == 429
