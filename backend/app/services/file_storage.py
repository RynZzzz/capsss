from pathlib import Path
import pandas as pd
from app.config import settings

class FileStorage:
    def __init__(self):
        self.upload_dir = Path(settings.UPLOAD_DIR)
        self.text_dir = Path(settings.TEXT_DIR)
        self.processed_dir = Path(settings.PROCESSED_DIR)
        
        # Create directories
        for directory in [self.upload_dir, self.text_dir, self.processed_dir]:
            directory.mkdir(exist_ok=True)
    
    def save_upload(self, filename: str, content: bytes) -> Path:
        """Save uploaded file"""
        file_path = self.upload_dir / filename
        with open(file_path, "wb") as f:
            f.write(content)
        return file_path
    
    def save_text(self, filename: str, content: str) -> Path:
        """Save text file"""
        file_path = self.text_dir / filename
        with open(file_path, "w", encoding='utf-8') as f:
            f.write(content)
        return file_path
    
    def save_dataframe(self, df: pd.DataFrame, filename: str, file_type: str) -> Path:
        """Save DataFrame based on file type"""
        if file_type == 'csv':
            output_path = self.processed_dir / filename
            df.to_csv(output_path, index=False)
        elif file_type == 'excel':
            output_path = self.processed_dir / filename
            df.to_excel(output_path, index=False)
        elif file_type == 'json':
            output_path = self.processed_dir / filename
            df.to_json(output_path, orient='records', indent=2)
        else:
            output_path = self.processed_dir / filename
            df.to_csv(output_path, index=False)
        
        return output_path
    
    def list_files(self) -> dict:
        """List all files"""
        return {
            "uploaded": [f.name for f in self.upload_dir.iterdir() if f.is_file()],
            "processed": [f.name for f in self.processed_dir.iterdir() if f.is_file()],
            "text_files": [f.name for f in self.text_dir.iterdir() if f.is_file()]
        }
    
    def delete_file(self, filename: str) -> bool:
        """Delete file from all directories"""
        deleted = False
        for directory in [self.upload_dir, self.processed_dir, self.text_dir]:
            file_path = directory / filename
            if file_path.exists():
                file_path.unlink()
                deleted = True
        return deleted

storage = FileStorage()