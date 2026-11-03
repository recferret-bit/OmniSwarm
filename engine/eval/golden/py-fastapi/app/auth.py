from fastapi import Header, HTTPException


def current_user(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401)
    return {"id": authorization.removeprefix("Bearer ")}
