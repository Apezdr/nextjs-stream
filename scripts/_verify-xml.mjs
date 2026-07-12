const url =
  'http://localhost:3000/api/media-activity/xml/status/sessions?token=YDqP9HgFNlZKzSLJ80GEWBkA16s4Xhj5byiduUnaCfRpmV7w'
const t = await (await fetch(url)).text()
const grab = (re) => (t.match(re) || ['(none)'])[0]
console.log('size:', (t.match(/MediaContainer size="(\d+)"/) || [])[1])
console.log('PLAYER:', grab(/<Player[^>]*>/))
console.log('MEDIA:', grab(/<Media[^>]*>/))
console.log('STREAM:', grab(/<Stream[^>]*>/))
console.log('PART:', grab(/<Part[^>]*>/))
