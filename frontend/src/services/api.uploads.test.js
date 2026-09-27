// Guards the trap behind "Import failed" in the backup card.
//
// The api instance asks for application/json by default, and axios acts on that header *before* the
// request leaves the browser: when the content type says JSON it turns a FormData body into a JSON
// string (axios lib/defaults/index.js, transformRequest). The uploaded backup therefore arrived as
// {"dbFile":{}} with the file gone, express-fileupload saw no multipart body at all, and the API
// answered 400 "No backup file arrived: the request body was sent as application/json".
//
// The request interceptor in services/api.js now drops the header for FormData bodies, so the
// browser sends multipart/form-data itself - boundary included.
import api, { authAPI, systemAPI } from './api';

// The adapter is what axios hands the finished request to, right after transformRequest has run, so
// what it records is what a server would receive. Recording instead of sending keeps this offline.
const sent = [];
const recordingAdapter = (config) => {
  sent.push(config);
  return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
};

const backupFile = () =>
  new File([new Uint8Array([80, 75, 3, 4])], 'bookarr-backup-2026-09-27.zip', { type: 'application/zip' });

beforeEach(() => {
  sent.length = 0;
  api.defaults.adapter = recordingAdapter;
});

afterAll(() => {
  delete api.defaults.adapter;
});

describe('backup uploads', () => {
  it('posts the file as form data instead of JSON', async () => {
    const formData = new FormData();
    formData.append('dbFile', backupFile());

    await systemAPI.restoreBackup(formData);

    const { data, headers } = sent[0];
    expect(data).toBeInstanceOf(FormData);
    expect(data.get('dbFile')).toBeInstanceOf(File);
    expect(String(headers.get('Content-Type') || '')).not.toMatch(/application\/json/i);
  });

  it('still serializes the ordinary JSON requests', async () => {
    await authAPI.login({ email: 'reader@example.com', password: 'secret' });

    const { data, headers } = sent[0];
    expect(String(headers.get('Content-Type'))).toMatch(/application\/json/i);
    expect(JSON.parse(data)).toEqual({ email: 'reader@example.com', password: 'secret' });
  });
});
