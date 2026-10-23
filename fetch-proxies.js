const fs = require('fs');

const sources = [
  'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt',
  'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
  'https://raw.githubusercontent.com/iplocate/free-proxy-list/main/protocols/socks5.txt',
  'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=socks5&proxy_format=ipport&format=text',
  'https://www.proxy-list.download/api/v1/get?type=socks5',
  'https://proxyspace.pro/socks5.txt'
];

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  const all = new Set();
  for (const url of sources) {
    try {
      const text = await fetchWithTimeout(url, 25000);
      let count = 0;
      for (const line of text.split(/\r?\n/)) {
        const m = line.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
        if (m) {
          const port = Number(m[2]);
          if (port > 0 && port < 65536) { all.add(m[1] + ':' + port); count++; }
        }
      }
      console.log(url, '->', count);
    } catch (e) {
      console.log(url, 'FAILED:', e.message);
    }
  }
  const list = [...all];
  fs.writeFileSync('proxies-all.txt', list.join('\n') + '\n');
  console.log('TOTAL UNIQUE:', list.length);
})();
