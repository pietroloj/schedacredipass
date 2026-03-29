export async function handler(event) {
  try {
    const provincia = event.queryStringParameters?.provincia || '';
    const nome = event.queryStringParameters?.nome || '';
    const cognome = event.queryStringParameters?.cognome || '';

    const slugify = (text) =>
      String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');

    if (!provincia || !nome || !cognome) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: 'Parametri mancanti: provincia, nome, cognome'
        })
      };
    }

    const slug = `${slugify(provincia)}-${slugify(nome)}-${slugify(cognome)}`;
    const pageUrl = `https://www.credipass.it/consulenti/${slug}/`;

    const response = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Netlify Function)'
      }
    });

    if (!response.ok) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: 'Pagina referente non trovata',
          pageUrl
        })
      };
    }

    const html = await response.text();

    let imageUrl = null;

    const photoWrapperMatch = html.match(
      /<div[^>]*class="[^"]*photo-wrapper[^"]*"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i
    );

    if (photoWrapperMatch && photoWrapperMatch[1]) {
      imageUrl = photoWrapperMatch[1];
    }

    if (!imageUrl) {
      const fallbackMatch = html.match(/<img[^>]+src="([^"]+)"[^>]*>/i);
      if (fallbackMatch && fallbackMatch[1]) {
        imageUrl = fallbackMatch[1];
      }
    }

    if (!imageUrl) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: 'Immagine non trovata nella pagina',
          pageUrl
        })
      };
    }

    if (imageUrl.startsWith('//')) {
      imageUrl = `https:${imageUrl}`;
    } else if (imageUrl.startsWith('/')) {
      imageUrl = `https://www.credipass.it${imageUrl}`;
    }

    // scarico l'immagine lato server
    const imageResponse = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Netlify Function)',
        'Referer': pageUrl
      }
    });

    if (!imageResponse.ok) {
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: false,
          error: `Download immagine fallito (${imageResponse.status})`,
          imageUrl
        })
      };
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const imageBase64 = `data:${contentType};base64,${base64}`;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        slug,
        pageUrl,
        imageUrl,
        imageBase64
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: error.message || 'Errore interno'
      })
    };
  }
}
