# BAT accident-image severity classifier

This module predicts a **suggested** visual severity: `minor`, `moderate`, or `severe`.
It is decision support only; users and administrators must confirm the final report severity. Do not infer a fatality from an image alone.

## 1. Build the dataset

Use only images you have the right to use, remove faces/number plates where possible, and do not include graphic images unnecessarily. Label each image after review by at least two people:

```
ml/data/
  train/minor/       # superficial damage / low apparent risk
  train/moderate/    # major damage / likely urgent attention
  train/severe/      # major collision scene / immediate emergency indicators
  validation/minor/
  validation/moderate/
  validation/severe/
```

Start with at least 300 reviewed images per class, split approximately 80% training and 20% validation. Keep the same accident out of both splits.

## 2. Create and train

From this `ml` folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python train.py --data-dir data --epochs 12
```

The best model is written to `artifacts/severity_classifier.pt` with its validation accuracy in `artifacts/metadata.json`.

## 3. Run predictions locally

```powershell
uvicorn serve:app --host 127.0.0.1 --port 8001
```

`GET /health` shows whether a model is ready. `POST /predict` accepts an image file under `file` and returns the suggested label, confidence, class probabilities, and a human-review flag.

## 4. Connect it to Report Accident

After validation accuracy and per-class recall are acceptable, add the image upload endpoint to the Node server and forward the image to `http://127.0.0.1:8001/predict`. Display the result as a suggestion only; do not silently overwrite the reporter's selected severity. Store the suggested label, confidence, model version, and reviewer decision to measure model quality over time.

## Before releasing

Evaluate a held-out test set, check errors by lighting/camera/weather, use a confidence threshold, log disagreements, and ensure all severe suggestions get human review.
