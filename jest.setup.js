// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'
import { TextEncoder, TextDecoder } from 'util'

global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder

// next/jest loads .env.local, whose REDIS_HOST names a real Redis: no test may
// reach it. A test that needs Redis sets these itself (redisClient.test.js)
delete process.env.REDIS_HOST
delete process.env.REDIS_PORT
delete process.env.REDIS_PASSWORD
