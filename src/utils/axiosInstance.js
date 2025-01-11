import axios from 'axios';
import http from 'http';
import https from 'https';

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 500,
  keepAliveMsecs: 60000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 500,
  keepAliveMsecs: 60000,
});

const axiosInstance = axios.create({
  httpAgent,
  httpsAgent,
  timeout: 10000, // 10 seconds timeout
  headers: {
    'Accept-Encoding': 'gzip, deflate', // Enable compression
  },
  decompress: true, // Ensure Axios can handle compressed responses
});

export default axiosInstance;
