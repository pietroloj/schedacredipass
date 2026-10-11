"""Public configuration for the existing consultation deployment."""
import os
DEFAULTS={
'HUB_BASE_PATH':'/social-hub',
'HUB_SIGNED_MEDIA_URL':'https://us-central1-consulenza-credipass.cloudfunctions.net/socialHub/social-hub/media',
'PUBLIC_BASE_URL':'https://consulenza-credipass.it/social-hub',
'FIREBASE_PROJECT_ID':'consulenza-credipass',
'FIREBASE_WEB_API_KEY':'AIzaSyDDRWJpEhFb2zBB9MlkbEel_9cXOTTKBJ4',
'FIREBASE_STORAGE_BUCKET':'consulenza-credipass.firebasestorage.app'}
for key,value in DEFAULTS.items():os.environ.setdefault(key,value)
