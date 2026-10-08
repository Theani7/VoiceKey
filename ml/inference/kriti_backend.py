"""Kriti ASR backend implementation."""

from pathlib import Path
from typing import List, Union
from ml.models.base import VoiceKeyASRBase

class KritiBackend(VoiceKeyASRBase):
    def __init__(self, repo_id: str = "harrrshall/kriti", device: str | None = None):
        try:
            from ml.kriti.model import load_model
        except ImportError:
            from kriti import load_model
        import torch

        if device is None:
            # Check MPS / Apple Silicon GPU or CPU
            if torch.backends.mps.is_available():
                device = "cpu"  # NeMo Conformer RNN-T currently most stable on CPU on macOS
            else:
                device = "cpu"
        self.device = device
        self.model = load_model(repo_id=repo_id, device=self.device)

    def transcribe(self, audio: Union[str, Path, List[Union[str, Path]]]) -> Union[str, List[str]]:
        return self.model.transcribe(audio)
