# routers/auth.py
# OAuth authentication routes (Google, GitHub, etc.)

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from typing import Optional
import requests
import hashlib, os, hmac, binascii

from app.db.connection import get_db
from app.db import crud
from app.db.models import AuthProviderEnum

_ITERATIONS = 260_000  # OWASP 2023 recommendation for PBKDF2-SHA256


def _hash_password(password: str) -> str:
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return binascii.hexlify(salt).decode() + ":" + binascii.hexlify(key).decode()


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, key_hex = stored.split(":")
        salt = binascii.unhexlify(salt_hex)
        expected = binascii.unhexlify(key_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False

router = APIRouter(prefix="/api", tags=["Authentication"])

# ─── REQUEST MODELS ───────────────────────────────────────────────────────────

class GoogleAuthRequest(BaseModel):
    """Request body for Google OAuth login"""
    token: str  # Google access_token from frontend


class AuthResponse(BaseModel):
    """Standardized auth response"""
    status: str
    message: str
    user_id: int
    user_email: str
    user_name: str
    is_new_user: bool


# ─── GOOGLE OAUTH ─────────────────────────────────────────────────────────────

@router.post("/google")
async def google_auth(
    auth_data: GoogleAuthRequest,
    db: Session = Depends(get_db),
) -> AuthResponse:
    """
    Authenticate user with Google OAuth access token.
    
    Flow:
    1. Verify token with Google API
    2. Check if account exists (by provider_id)
    3. If exists → return user info
    4. If new → create User + Account records
    
    Returns:
        AuthResponse with user_id, email, name, and is_new_user flag
    """
    try:
        # ── Step 1: Verify token with Google ──────────────────────────────────
        user_info_response = requests.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            params={"access_token": auth_data.token},
            timeout=5,  # prevent hanging
        )

        if not user_info_response.ok:
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired Google access token"
            )

        id_info = user_info_response.json()
        
        # Extract Google user info
        google_sub = id_info.get('sub')  # Google's unique user ID
        email      = id_info.get('email')
        name       = id_info.get('name', 'Unknown User')
        picture    = id_info.get('picture')  # optional: store avatar URL

        if not google_sub or not email:
            raise HTTPException(
                status_code=400,
                detail="Google token missing required user info (sub or email)"
            )

        # ── Step 2: Check if account already exists ───────────────────────────
        existing_account = crud.get_account_by_provider(
            db, 
            provider="Google", 
            provider_id=google_sub
        )

        if existing_account:
            # User has logged in before → return their info
            user = crud.get_user_by_id(db, existing_account.user_id)
            
            if not user:
                # Edge case: account exists but user was deleted
                raise HTTPException(
                    status_code=500,
                    detail="Account record exists but user not found"
                )

            return AuthResponse(
                status="success",
                message="Welcome back!",
                user_id=user.id,
                user_email=user.email,
                user_name=user.username,
                is_new_user=False,
            )

        # ── Step 3: New user → create User + Account ──────────────────────────
        
        # 3a. Check if email is already used (prevents duplicate emails)
        existing_user_by_email = crud.get_user_by_email(db, email)
        
        if existing_user_by_email:
            # User exists with this email but hasn't linked Google yet
            # → Link Google account to existing user
            crud.create_account(
                db=db,
                user_id=existing_user_by_email.id,
                provider="Google",
                provider_id=google_sub,
                access_token=auth_data.token,  # store for future API calls
                refresh_token=None,  # Google doesn't always give refresh tokens
            )
            
            return AuthResponse(
                status="success",
                message="Google account linked to existing user",
                user_id=existing_user_by_email.id,
                user_email=existing_user_by_email.email,
                user_name=existing_user_by_email.username,
                is_new_user=False,
            )
        
        # 3b. Completely new user → create both User and Account
        new_user = crud.create_user(
            db=db,
            username=name,  # Google name → username
            email=email,  # OAuth users have no password
        )

        crud.create_account(
            db=db,
            user_id=new_user.id,
            provider="Google",
            provider_id=google_sub,
            access_token=auth_data.token,
        )

        return AuthResponse(
            status="success",
            message="Account created successfully",
            user_id=new_user.id,
            user_email=new_user.email,
            user_name=new_user.username,
            is_new_user=True,
        )

    except requests.RequestException as e:
        # Network error contacting Google
        raise HTTPException(
            status_code=503,
            detail=f"Failed to contact Google API: {str(e)}"
        )
    except HTTPException:
        # Re-raise FastAPI exceptions as-is
        raise
    except Exception as e:
        # Catch-all for unexpected errors
        print(f"❌ Google Auth Error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail="Internal authentication error"
        )


# ─── EMAIL / PASSWORD AUTH ────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str


class LoginEmailRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/register")
async def register(
    data: RegisterRequest,
    db: Session = Depends(get_db),
) -> AuthResponse:
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    if crud.get_user_by_email(db, data.email):
        raise HTTPException(status_code=409, detail="Email already registered")

    if crud.get_user_by_username(db, data.username):
        raise HTTPException(status_code=409, detail="Username already taken")

    password_hash = _hash_password(data.password)
    new_user = crud.create_local_user(db, username=data.username, email=data.email, password_hash=password_hash)

    return AuthResponse(
        status="success",
        message="Account created successfully",
        user_id=new_user.id,
        user_email=new_user.email,
        user_name=new_user.username,
        is_new_user=True,
    )


@router.post("/login/email")
async def login_email(
    data: LoginEmailRequest,
    db: Session = Depends(get_db),
) -> AuthResponse:
    account = crud.get_local_account_by_email(db, data.email)

    if not account or not account.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if not _verify_password(data.password, account.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user = crud.get_user_by_id(db, account.user_id)
    if not user:
        raise HTTPException(status_code=500, detail="User record not found")

    return AuthResponse(
        status="success",
        message="Welcome back!",
        user_id=user.id,
        user_email=user.email,
        user_name=user.username,
        is_new_user=False,
    )


# ─── GITHUB OAUTH (STUB) ──────────────────────────────────────────────────────

@router.post("/github")
async def github_auth(
    token: str,
    db: Session = Depends(get_db),
):
    """
    GitHub OAuth authentication (not yet implemented).
    
    Flow would be similar to Google:
    1. Verify token with https://api.github.com/user
    2. Check if account exists
    3. Create or return user
    """
    raise HTTPException(
        status_code=501,
        detail="GitHub authentication not yet implemented"
    )


# ─── LOGOUT ───────────────────────────────────────────────────────────────────

@router.post("/logout")
async def logout(user_id: int, db: Session = Depends(get_db)):
    """
    Logout endpoint (optional — frontend can just delete tokens).
    
    If you're storing access tokens in the DB, you could invalidate them here.
    For now, this is a no-op since JWT/OAuth tokens are client-side.
    """
    return JSONResponse({
        "status": "success",
        "message": "Logged out successfully"
    })


# ─── GET CURRENT USER ─────────────────────────────────────────────────────────

@router.get("/me")
async def get_current_user(
    user_id: int,  # In production, extract from JWT token
    db: Session = Depends(get_db),
):
    """
    Get current authenticated user's info.
    
    In production:
    - Extract user_id from a JWT token (Authorization: Bearer <token>)
    - Use a proper dependency like `current_user = Depends(get_current_user)`
    
    For now, accepts user_id as a query param.
    """
    user = crud.get_user_by_id(db, user_id)
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Get all linked OAuth accounts
    accounts = crud.get_accounts_by_user(db, user_id)

    return JSONResponse({
        "user_id": user.id,
        "username": user.username,
        "email": user.email,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat(),
        "linked_accounts": [
            {
                "provider": acc.provider.value,
                "provider_id": acc.provider_id,
                "linked_at": acc.created_at.isoformat(),
            }
            for acc in accounts
        ],
    })
