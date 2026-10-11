"""Additional Firebase codebase: does not replace the consultation functions."""
import os
import threading
import cloud_config
from pathlib import Path
from firebase_functions import https_fn, scheduler_fn, options
from firebase_functions.params import SecretParam

OPENAI_API_KEY=SecretParam('OPENAI_API_KEY')
SOCIAL_HUB_MASTER_KEY=SecretParam('SOCIAL_HUB_MASTER_KEY')
_service=None
_lock=threading.Lock()


def service():
    global _service
    with _lock:
        if _service is None:
            # Enforce server identity even if an installer accidentally selects local mode.
            os.environ.update(HUB_AUTH='firebase',HUB_STORE='firestore',HUB_DATA_DIR='/tmp/credipass-social-hub',HUB_MASTER_KEY=SOCIAL_HUB_MASTER_KEY.value)
            from settings import Settings
            from service import Service
            _service=Service(Settings(Path(__file__).parent))
    return _service


@https_fn.on_request(region='us-central1',secrets=[OPENAI_API_KEY,SOCIAL_HUB_MASTER_KEY],
                     memory=options.MemoryOption.GB_1,timeout_sec=300,max_instances=3,
                     concurrency=8,invoker='public')
def socialHub(req: https_fn.Request) -> https_fn.Response:
    from cloud_http import dispatch,response
    try:return dispatch(req,service())
    except Exception:return response({'error':'Configurazione Social Hub non disponibile.'},503)


@scheduler_fn.on_schedule(schedule='every 1 minutes',region='us-central1',
                         secrets=[SOCIAL_HUB_MASTER_KEY],memory=options.MemoryOption.GB_1,
                         timeout_sec=540,max_instances=1,retry_count=0)
def socialHubSchedule(event: scheduler_fn.ScheduledEvent) -> None:
    hub=service()
    hub.tick()
    hub.import_tick()
