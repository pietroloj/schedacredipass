"""Buffer GraphQL integration. Credentials never appear in error messages."""
from network import RemoteError

FIELDS='id name service isDisconnected isLocked isQueuePaused'
class BufferAPI:
    def __init__(self,http):self.http=http
    def query(self,token,query,variables=None,final=False):
        result=self.http.request('POST','https://api.buffer.com',{'query':query,'variables':variables or {}},{'Authorization':'Bearer '+token},final=final)
        if result.get('errors') or not isinstance(result.get('data'),dict):
            raise RemoteError('Buffer non ha confermato la richiesta. Controlla chiave, permessi e limiti del piano.',uncertain=final)
        return result['data']
    def channels(self,token):
        data=self.query(token,'query { account { organizations { id } } }')
        channels=[]
        for org in data['account']['organizations']:
            data=self.query(token,'query($input:ChannelsInput!){channels(input:$input){'+FIELDS+'}}',{'input':{'organizationId':org['id']}})
            channels.extend(c for c in data['channels'] if c['service']=='tiktok')
        return channels
    def channel(self,token,channel_id):
        c=self.query(token,'query($input:ChannelInput!){channel(input:$input){'+FIELDS+'}}',{'input':{'id':channel_id}})['channel']
        if c['service']!='tiktok' or c['id']!=channel_id:raise ValueError('Seleziona il canale TikTok corretto')
        if c['isDisconnected'] or c['isLocked'] or c['isQueuePaused']:raise ValueError('Il canale Buffer è scollegato, bloccato o in pausa: controllalo in Buffer')
        return c
    def post(self,token,post_id):
        return self.query(token,'query($input:PostInput!){post(input:$input){id status schedulingType externalLink}}',{'input':{'id':post_id}})['post']
    def create(self,token,payload):
        data=self.query(token,'mutation($input:CreatePostInput!){createPost(input:$input){... on PostActionSuccess {post{id status schedulingType externalLink}} ... on MutationError {message}}}',{'input':payload},final=True)['createPost']
        if not data.get('post',{}).get('id'):raise RemoteError('Buffer non ha confermato la creazione. Verifica in Buffer prima di riprovare.',uncertain=True)
        return data['post']
