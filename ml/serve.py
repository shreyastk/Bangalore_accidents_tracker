"""Local inference API for the trained severity model."""
from __future__ import annotations

import io
from pathlib import Path

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image
from torchvision import transforms

CLASSES = ["minor", "moderate", "severe"]
MODEL_PATH = Path(__file__).parent / "artifacts" / "severity_classifier.pt"
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])
app = FastAPI(title="BAT Severity Classifier", version="0.1.0")


def load_model() -> torch.jit.ScriptModule:
    if not MODEL_PATH.exists():
        raise HTTPException(503, "Model unavailable. Train it first with python train.py.")
    model = torch.jit.load(str(MODEL_PATH), map_location="cpu")
    model.eval()
    return model


@app.get("/health")
def health() -> dict:
    return {"ok": True, "model_ready": MODEL_PATH.exists(), "classes": CLASSES}


@app.post("/predict")
async def predict(file: UploadFile = File(...)) -> dict:
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(415, "Please upload an image file.")
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "Image must be 10 MB or smaller.")
    try:
        image = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as error:
        raise HTTPException(400, "Could not read this image.") from error

    model = load_model()
    with torch.no_grad():
        probabilities = torch.softmax(model(transform(image).unsqueeze(0)), dim=1)[0].tolist()
    best_index = max(range(len(probabilities)), key=probabilities.__getitem__)
    return {
        "suggested_severity": CLASSES[best_index],
        "confidence": round(probabilities[best_index], 4),
        "probabilities": dict(zip(CLASSES, (round(value, 4) for value in probabilities))),
        "requires_human_review": probabilities[best_index] < 0.75,
    }
