const withQuery = (url, queryRecord) => {
  const newUrl = new URL(url);
  
  // Добавляем каждый ключ-значение в параметры поиска
  Object.entries(queryRecord).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      newUrl.searchParams.append(key, value);
    }
  });

  return newUrl.toString();
};

const getIds = (tracks) => tracks.map(v => v.id);

const delay = (ms) =>
  new Promise((res) => {
    setTimeout(() => res(), ms)
  });

const createFetches = (userId, token, {
  appVersion=1773236899,
  clientId='nzPYwsAlOGYAuvpzgYO40oV0IVvysQFi'
} = {}) => {
  const appFetch = (url, { method = 'GET', body = null } = {}) =>
    fetch(
      url, {
      headers: {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "accept-language": "ru,en;q=0.9",
        "authorization": token,
      },
      referrer: "https://soundcloud.com/",
      body: body,
      method,
      mode: "cors",
      credentials: "include"
    }).then(v => v.json());

  const fetchLikes = ({  
    limit=100,
    offset=0,  
  } = {}) =>
    appFetch(
      withQuery(
        `https://api-v2.soundcloud.com/users/${userId}/track_likes`, {
          client_id: clientId,
          limit: limit,
          offset: offset,
          linked_partitioning: 1,
          app_version: appVersion,
          app_locale: 'en',
      })
    ).then(v => v.collection.map(e => e.track));

  const fetchLikesAuto = async (targetLength) => {
    const allTracks = [];
    const limit = 100; // Максимально допустимый лимит за один запрос

    const delayMs = 3000;

    let offset = 0;

    while (allTracks.length < targetLength) {
      // Вычисляем, сколько еще нужно добрать (чтобы не взять лишнего в последнем запросе)
      const remaining = targetLength - allTracks.length;
      const currentLimit = Math.min(limit, remaining);

      await delay(delayMs);

      try {
        // Вызываем вашу исходную функцию
        const tracks = await fetchLikes({ limit: currentLimit, offset });

        if (tracks.length === 0) {
          break; // Больше треков нет, выходим из цикла
        }

        allTracks.push(...tracks);
        offset += tracks.length;

        console.log(`Fetched ${allTracks.length} / ${targetLength}`);
      } catch (error) {
        console.error("Error fetching likes:", error);
        break; 
      }
    }

    return allTracks.slice(0, targetLength);
  };

  const likeTrack = (trackId) => appFetch(
    withQuery(
      `https://api-v2.soundcloud.com/users/${userId}/track_likes/${trackId}`, {
        client_id: clientId,
        app_version: appVersion,
        app_locale: 'en',
    }), {
    method: 'PUT'
  });

  const likeTracks = async (tracks) => {
    const delayMs = 1500;

    console.log(`Total time: ${( (tracks.length * (delayMs / 1000)) / 60 ).toFixed(1)} minutes`)

    for(const track of tracks) {
      await likeTrack(track);

      console.log(`Track ${track} liked`)
      await delay(delayMs);
    }
  };

  const likeTracksReverse = (tracks) => likeTracks(tracks.slice(0).reverse());

  return { fetchLikesAuto, fetchLikes, likeTracks, likeTracksReverse };
};

const parseLikeRequest = (curlRequest) => {
  const lines = curlRequest.split('\\');

  // Регулярка ищет цифры сразу после "/users/"
  const userIdMatch = lines[0].match(/\/users\/(\d+)/);
  const userId = userIdMatch ? userIdMatch[1] : null;

  // Регулярка ищет текст после "Authorization: " до закрывающей кавычки
  const authRegex = /Authorization:\s*([^'\s]+\s[^'\s]+)/;

  const match = curlRequest.match(authRegex);
  const token = match ? match[1] : null;

  return { userId, token };
};

const getCredentials = async () => {
  const userIdParts = localStorage.getItem('sc_tracking_user_id')?.replaceAll('"', '').trim().split(':');

  if(!userIdParts?.length) {
    console.warn('User id not found');
    return {};
  }

  const userId = userIdParts[userIdParts.length - 1];
  
  const partToken = await cookieStore.get('oauth_token').then(v => v.value);

  if(!partToken) {
    console.warn('OAuth token not found');
    return {};
  }

  const token = `OAuth ${partToken}`;

  return { userId, token };
};

const dumpLikes = async (targetCount = undefined) => {
  const { userId, token } = await getCredentials();
  if(!userId || !token) return;

  const v = createFetches(userId, token);

  const fetchPromise = targetCount != null
    ? v.fetchLikesAuto(targetCount)
    : v.fetchLikes();

  fetchPromise
    .then(getIds)
    .then(console.log)
};

const loadLikes = async (likes) => {
  const { userId, token } = await getCredentials();
  const v = createFetches(userId, token);

  v.likeTracksReverse(likes);
};
