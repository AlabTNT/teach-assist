import axios from 'axios';
import https from 'https';
import crypto from 'crypto';

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";

// Custom agent for legacy ZJU servers
export const legacyAgent = new https.Agent({
  ciphers: 'DEFAULT@SECLEVEL=1',
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
  rejectUnauthorized: false,
});

export const zjuClient = axios.create({
  headers: { 
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'
  },
  httpsAgent: legacyAgent,
  maxRedirects: 0,
  validateStatus: (status) => status >= 200 && status < 400
});

function rsaEncrypt(password: string, modulusHex: string, exponentHex: string): string {
  let pwd = 0n;
  for (let i = 0; i < password.length; i++) {
    pwd = pwd * 256n + BigInt(password.charCodeAt(i));
  }
  const m = BigInt('0x' + modulusHex);
  const e = BigInt('0x' + exponentHex);
  
  let res = 1n;
  let base = pwd % m;
  let exp = e;
  while (exp > 0n) {
    if (exp % 2n === 1n) res = (res * base) % m;
    exp = exp / 2n;
    base = (base * base) % m;
  }
  
  let enc = res.toString(16);
  while (enc.length < modulusHex.length) enc = '0' + enc;
  return enc;
}

export class ZJUAM {
  private cookies: string[] = [];

  constructor(private username: string, private password: string) {}

  private extractExecution(html: string): string {
    const match = html.match(/name="execution" value="([^"]+)"/);
    if (!match) throw new Error("No execution in CAS login page");
    return match[1];
  }

  private extractMessage(html: string): string {
    const match = html.match(/<span id="msg">([^<]+)<\/span>/);
    return match ? match[1] : 'Unknown login error';
  }

  public async login(): Promise<string> {
    const loginUrl = "https://zjuam.zju.edu.cn/cas/login";
    
    // 1. Get execution token and cookies
    const r1 = await zjuClient.get(loginUrl);
    if (r1.headers['set-cookie']) {
      this.cookies = r1.headers['set-cookie'].map(c => c.split(';')[0]);
    }
    const execution = this.extractExecution(r1.data);
    
    // 2. Get PubKey
    const r2 = await zjuClient.get("https://zjuam.zju.edu.cn/cas/v2/getPubKey", {
      headers: { 'Cookie': this.cookies.join('; ') }
    });
    const pub = r2.data;
    if (r2.headers['set-cookie']) {
      this.cookies = [...this.cookies, ...r2.headers['set-cookie'].map(c => c.split(';')[0])];
    }
    
    // 3. Encrypt password
    const enc = rsaEncrypt(this.password, pub.modulus, pub.exponent);
    
    // 4. Submit login
    const params = new URLSearchParams();
    params.append('username', this.username);
    params.append('password', enc);
    params.append('execution', execution);
    params.append('_eventId', 'submit');
    params.append('authcode', '');

    const r3 = await zjuClient.post(loginUrl, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': this.cookies.join('; ')
      }
    });

    if (r3.headers['set-cookie']) {
      this.cookies = [...this.cookies, ...r3.headers['set-cookie'].map(c => c.split(';')[0])];
    }

    if (r3.status === 302 && r3.headers.location) {
      return r3.headers.location;
    }
    
    throw new Error(`ZJUAM login failed: ${this.extractMessage(r3.data)}`);
  }

  public async loginService(serviceUrl: string, maxHops = 15): Promise<string> {
    let e = serviceUrl;
    let serviceCookies: string[] = [];
    
    for (let i = 0; i < maxHops; i++) {
      const urlObj = new URL(e);
      if (urlObj.hostname === 'zjuam.zju.edu.cn') break;
      
      const r = await zjuClient.get(e, {
        headers: serviceCookies.length > 0 ? { 'Cookie': serviceCookies.join('; ') } : {}
      });
      
      if (r.headers['set-cookie']) {
        serviceCookies = [...serviceCookies, ...r.headers['set-cookie'].map(c => c.split(';')[0])];
      }

      if (r.status >= 300 && r.status < 400 && r.headers.location) {
        e = new URL(r.headers.location, e).toString();
      } else {
        return e;
      }
    }

    const rCAS = await zjuClient.get(e, {
      headers: { 'Cookie': this.cookies.join('; ') }
    });

    let loc = rCAS.headers.location;
    for (let i = 0; i < maxHops; i++) {
      if (!loc) break;
      
      const rLoc = await zjuClient.get(loc, {
        headers: serviceCookies.length > 0 ? { 'Cookie': serviceCookies.join('; ') } : {}
      });

      if (rLoc.headers['set-cookie']) {
        serviceCookies = [...serviceCookies, ...rLoc.headers['set-cookie'].map(c => c.split(';')[0])];
      }

      const match = typeof rLoc.data === 'string' && rLoc.data.match(/meta http-equiv="refresh" content="0;URL=([^"]+)"/);
      if (rLoc.status === 200 && match) {
        loc = match[1].replace(/&amp;/g, '&');
        continue;
      }
      
      if (rLoc.status >= 300 && rLoc.status < 400 && rLoc.headers.location) {
        loc = new URL(rLoc.headers.location, loc).toString();
        continue;
      }
      break;
    }
    
    return serviceCookies.join('; ');
  }
}
