"""Abstract base class for VoiceKey ASR models."""

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Union, List

class VoiceKeyASRBase(ABC):
    """Abstract interface for speech recognition engines in VoiceKey."""

    @abstractmethod
    def transcribe(self, audio: Union[str, Path, List[Union[str, Path]]]) -> Union[str, List[str]]:
        """Transcribe audio file(s) into Nepali text."""
        pass
