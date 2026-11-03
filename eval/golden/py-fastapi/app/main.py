import os
import re
import subprocess

import yaml
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse

from .auth import current_user
from .store import invoices

app = FastAPI()
UPLOAD_DIR = "/srv/uploads"
REF = re.compile(r"^[0-9a-f]{7,40}$")


@app.get("/files/{filename}")
def download(filename: str, user=Depends(current_user)):
    return FileResponse(os.path.join(UPLOAD_DIR, filename))


@app.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int, user=Depends(current_user)):
    invoice = invoices.get(invoice_id)
    if invoice is None:
        raise HTTPException(status_code=404)
    return invoice


@app.post("/config")
async def load_config(request: Request, user=Depends(current_user)):
    body = await request.body()
    return yaml.safe_load(body)


@app.get("/commits/{ref}")
def commit(ref: str, user=Depends(current_user)):
    if not REF.fullmatch(ref):
        raise HTTPException(status_code=400)
    out = subprocess.run(["git", "log", "-1", "--format=%s", ref], check=True, capture_output=True, text=True)
    return {"subject": out.stdout.strip()}
