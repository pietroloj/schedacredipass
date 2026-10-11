"""Configuration: public settings and local-only secret key. Never print secrets."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def load_env():
    file = ROOT / '.env'
    if file.exists():
        for line in file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip().strip('\"').strip("'"))

load_env()

class Settings:
    def __init__(self, root=ROOT):
        self.root = Path(root)
        self.data = Path(os.getenv('HUB_DATA_DIR', str(self.root / 'data')))
        self.auth = os.getenv('HUB_AUTH', 'local')
        self.store = os.getenv('HUB_STORE', 'sqlite')
        self.project = os.getenv('FIREBASE_PROJECT_ID', '')
        self.firebase_key = os.getenv('FIREBASE_WEB_API_KEY', '')
        self.signed_media_url = os.getenv('HUB_SIGNED_MEDIA_URL', '').rstrip('/')
        self.bucket = os.getenv('FIREBASE_STORAGE_BUCKET', '')
        self.base_url = os.getenv('PUBLIC_BASE_URL', '').rstrip('/')
        self.base_path = os.getenv('HUB_BASE_PATH', '').rstrip('/')
        if self.base_path and (not self.base_path.startswith('/') or any(c not in '/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in self.base_path)):
            raise ValueError('HUB_BASE_PATH non valido')
        self.port = int(os.getenv('PORT', '8765'))
        self.host = '127.0.0.1' if self.auth == 'local' else os.getenv('HOST', '127.0.0.1')
        self.openai_model = os.getenv('OPENAI_MODEL', 'gpt-4.1')
        self.image_model = os.getenv('OPENAI_IMAGE_MODEL', 'gpt-image-1.5')
        self.graph_version = os.getenv('META_GRAPH_VERSION', 'v23.0')
        self.linkedin_version = os.getenv('LINKEDIN_VERSION', '202605')
        if self.auth not in ('local', 'firebase') or self.store not in ('sqlite', 'firestore'):
            raise ValueError('HUB_AUTH o HUB_STORE non validi')
        if self.auth=='local' and self.base_url:
            raise ValueError('Un indirizzo pubblico richiede HUB_AUTH=firebase: la modalità locale non ha login')
        if self.store == 'firestore' and self.auth != 'firebase':
            raise ValueError('Firestore richiede autenticazione Firebase')
        if self.auth == 'firebase' and not (self.project and self.firebase_key):
            raise ValueError('Configurare FIREBASE_PROJECT_ID e FIREBASE_WEB_API_KEY')
        self.data.mkdir(parents=True, exist_ok=True, mode=0o700)

    def encryption_key(self):
        from cryptography.fernet import Fernet
        key = os.getenv('HUB_MASTER_KEY')
        if key:
            Fernet(key.encode())
            return key.encode()
        if self.store == 'firestore':
            raise ValueError('Impostare HUB_MASTER_KEY persistente per cifrare le credenziali cloud')
        path = self.data / '.master-key'
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            return path.read_bytes()
        with os.fdopen(fd, 'wb') as f:
            key = Fernet.generate_key()
            f.write(key)
        return key
