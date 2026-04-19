var client_id = '';
var app_version = '';

const getErr = (message) => {
    console.error(message);    
    return Error(message);
};

const unliked = (() => {
  const key = '__unliked';
  let values = null;

  const setValues = (tracks) => {
    values = tracks.slice(0);
    localStorage.setItem(key, JSON.stringify(tracks));
  };

  const getValues = () => {
    if(values != null) return values;

    const rawUnliked = localStorage.getItem(key);

    if(!rawUnliked) return [];

    try {
      values = JSON.parse(rawUnliked);
      return values;
    } catch {
      getErr('Parse unliked failed');
      return [];
    }
  };

  return {
    getValues,
    setValues,
  }
})();

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

const getRandomInt = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const saltGenerator = (min, max) => {
    avg = Math.round((min + max) / 2);

    const generate = () => Math.round(getRandomInt(min, max));

    return {
        avg,
        generate,
    };
};

const getDelayMs = (ms, mul = 0.33) => {
    const saltMs = Math.round(ms * mul);
    const { generate } = saltGenerator(-saltMs, saltMs);

    return ms + generate();
};

const delay = (ms) => {
  console.debug(`Delay by ${ms / 1000} seconds`);

  return new Promise((res) => {
    setTimeout(() => res(), ms)
  });
}

const createFetches = (userId, token, {
  appVersion=app_version,
  clientId=client_id,
} = {}) => {
  if(!appVersion || !clientId) {
    throw getErr('App Version or Client Id not found! Call parseClient(url);');
  }

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
    }).then(res => {
        if(res.status > 299) {
            throw Error(res.status);
        }

        return res.json();
    });

  const mapLikes = v => ({ tracks: v.collection.map(e => e.track), nextRef: v.next_href });

  const firstFetchLikes = ({  
    limit=100,
  } = {}) =>
    appFetch(
      withQuery(
        `https://api-v2.soundcloud.com/users/${userId}/track_likes`, {
          client_id: clientId,
          limit: limit,          
          linked_partitioning: 1,
          app_version: appVersion,
          app_locale: 'en',
      })
    ).then(mapLikes);

  const fetchLikes = async () => {
    const allTracks = [];
    const limit = 50; // Максимально допустимый лимит за один запрос
    const delayMs = 1500;

    let nextRef = null;

    while (true) {
      const fetchPromise = nextRef == null
          ? firstFetchLikes({limit})
          : appFetch(nextRef).then(mapLikes);

      const { tracks, nextRef: newNextRef } = await fetchPromise;

      const isEqualsRef = nextRef === newNextRef;
      nextRef = newNextRef;
      
      tracks.forEach(v => allTracks.push(v));

      console.log(`Tracks pack received ${tracks.length}`);      
      await delay(getDelayMs(delayMs));

      if(nextRef == null || isEqualsRef) return allTracks;
    }
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

  const delayGenerator = ({delayMs, salt, count}) => {
    const totalMs = count * (delayMs + salt.avg);

    const generate = () => delayMs + salt.generate();

    return {
      totalMs,
      generate,
    }
  };

  const likesDelayGenerator = (tracksCount, longDelayEvery = 15) => {
    const longDelaysCount = Math.max(0, Math.round(tracksCount / longDelayEvery) - 1);    

    const shortDelay = delayGenerator({
      delayMs: 60 * 1000,
      salt: saltGenerator(20 * 1000, 60 * 1000),
      count: tracksCount - longDelaysCount,
    });

    const longDelay = delayGenerator({
      delayMs: 40 * 60 * 1000,
      salt: saltGenerator(5 * 60 * 1000, 15 * 60 * 1000),
      count: longDelaysCount,
    });

    const totalMs = shortDelay.totalMs + longDelay.totalMs;

    const generate = (i) => {
        const isLongDelay = i !== 0 && i % longDelayEvery === 0;

        const delay = isLongDelay
          ? longDelay
          : shortDelay;

        return delay.generate();
    };

    return {
        generate,
        totalMs,
    }
  };

  const likeTracks = async (
    tracks, {
    whenContinue = ((tracks) => {}),
    onIteration = ((i, tracks) => {}),
  } = {}) => {
    const likesDelay = likesDelayGenerator(tracks.length);

    const totalTimeMinutes = ( ( likesDelay.totalMs / 1000 ) / 60 ).toFixed(1);

    console.log(`Total time: ${totalTimeMinutes} minutes`);

    let i = 0;
    for (const track of tracks) {
      try {
        onIteration(i, tracks);
        await likeTrack(track);
      } catch(e) {
        console.log('Continue:');
        whenContinue(tracks.slice(i));
        return;
      }

      console.log(`Track ${track} liked (${i + 1}/${tracks.length})`);
      await delay(likesDelay.generate(i));  
      i = i + 1;
    }
  };

  const likeTracksReverse = (
    tracks, {
    whenContinue = ((tracks) => {}),
    onIteration = ((i, tracks) => {}),
  }) =>
    likeTracks(
      tracks.slice(0).reverse(), {
      whenContinue: (tracks) => whenContinue(tracks.slice(0).reverse()),
      onIteration: (i, tracks) => onIteration(i, tracks.slice(0).reverse()),
    });

  return { fetchLikes, likeTracks, likeTracksReverse };
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

const createClientParser = () => {
    const storageKey = '___clientInfo';

    const save = (appVersion, clientId) => {
        localStorage.setItem(storageKey, JSON.stringify({ appVersion, clientId }));
    }

    const fromStorage = () => {
        const saved = localStorage.getItem(storageKey);
    
        if(saved == null) return {};
    
        try {
            const { appVersion, clientId } = JSON.parse(saved);
            return { appVersion, clientId }
        } catch(e) {
            return {};
        }
    };

    const fromUrl = (url) => {
        const params = new URLSearchParams(new URL(url).search);
    
        appVersion = params.get('app_version');
        clientId = params.get('client_id');

        return { appVersion, clientId };
    };

    const parse = (url = '') => {
        const parser = !!url
            ? () => fromUrl(url)
            : () => fromStorage();

        const { appVersion, clientId } = parser();

        if(!appVersion || !clientId) {
            throw getErr('appVersion or clientId parse failed. Call manualy parseClient(url);');
        }

        app_version = appVersion;
        client_id = clientId;

        console.log(`
appVersion: ${appVersion}
clientId: ${clientId}
            `);

        save(appVersion, clientId);
    };

    return parse;
};

const parseClient = createClientParser();

const dumpLikes = async () => {
  const { userId, token } = await getCredentials();
  if(!userId || !token) return;

  const v = createFetches(userId, token);

  v.fetchLikes()
    .then(getIds)
    .then(JSON.stringify)
    .then(console.log);
};

const loadLikes = async (likes) => {
  const { userId, token } = await getCredentials();
  const v = createFetches(userId, token);
  
  v.likeTracksReverse(
    likes, {
    whenContinue: (otherTracks) => {
      unliked.setValues(otherTracks.slice(0));
      console.log('Call this: \ncontinueLoads();')    
    },
    onIteration: (i, tracks) => {
      unliked.setValues(tracks.slice(i));
    },
  });
};

const dumpUnliked = () => {
    console.log(`loadLikes(${JSON.stringify(unliked.getValues())});`)
};

const continueLoads = () =>
  loadLikes(unliked.getValues());

parseClient();
