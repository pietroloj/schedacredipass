from cryptography.fernet import Fernet,InvalidToken

class Vault:
    def __init__(self,settings,store):self.cipher=Fernet(settings.encryption_key());self.store=store
    def save(self,key,value):
        self.store.put('secrets',{'ciphertext':self.cipher.encrypt(value.encode()).decode()},key)
    def read(self,key):
        doc=self.store.get('secrets',key)
        if not doc:return ''
        try:return self.cipher.decrypt(doc['ciphertext'].encode()).decode()
        except InvalidToken:raise ValueError('Chiave di cifratura diversa: ripristinare HUB_MASTER_KEY originale') from None
