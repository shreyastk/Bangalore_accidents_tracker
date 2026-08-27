"""Train an accident-image severity classifier.

Expected data layout:
data/
  train/{minor,moderate,severe}/image.jpg
  validation/{minor,moderate,severe}/image.jpg
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from torch import nn
from torch.utils.data import DataLoader
from torchvision import datasets, models, transforms

CLASSES = ["minor", "moderate", "severe"]


def build_model() -> nn.Module:
    # Transfer learning gives a useful starting point without training a large
    # vision model from scratch. The final layer is trained for our 3 classes.
    model = models.resnet18(weights=models.ResNet18_Weights.DEFAULT)
    model.fc = nn.Linear(model.fc.in_features, len(CLASSES))
    return model


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default="data")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--output-dir", default="artifacts")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    train_dir, validation_dir = data_dir / "train", data_dir / "validation"
    if not train_dir.exists() or not validation_dir.exists():
        raise SystemExit("Create data/train and data/validation with minor, moderate, and severe folders first.")

    transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(brightness=0.1, contrast=0.1),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    validation_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    train_set = datasets.ImageFolder(train_dir, transform=transform)
    validation_set = datasets.ImageFolder(validation_dir, transform=validation_transform)
    if train_set.classes != CLASSES or validation_set.classes != CLASSES:
        raise SystemExit("Folder names must be exactly: minor, moderate, severe.")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_model().to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)
    loss_fn = nn.CrossEntropyLoss()
    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=0)
    validation_loader = DataLoader(validation_set, batch_size=args.batch_size, num_workers=0)

    best_accuracy = -1.0
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    for epoch in range(args.epochs):
        model.train()
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad()
            loss_fn(model(images), labels).backward()
            optimizer.step()

        model.eval()
        correct = total = 0
        with torch.no_grad():
            for images, labels in validation_loader:
                predictions = model(images.to(device)).argmax(dim=1).cpu()
                correct += int((predictions == labels).sum())
                total += len(labels)
        accuracy = correct / max(total, 1)
        print(f"epoch={epoch + 1} validation_accuracy={accuracy:.3f}")
        if accuracy > best_accuracy:
            best_accuracy = accuracy
            scripted = torch.jit.script(model.cpu())
            scripted.save(output_dir / "severity_classifier.pt")
            model.to(device)

    (output_dir / "metadata.json").write_text(json.dumps({
        "classes": CLASSES,
        "validation_accuracy": best_accuracy,
        "image_size": 224,
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
