const { google } = require('googleapis');

// Helper to get Google Sheets client
async function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  const auth = new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    scopes
  );
  return google.sheets({ version: 'v4', auth });
}

// Your Google Sheet ID and range (customize as needed)
const SPREADSHEET_ID = '1pi6eOGp7Y6MU993MVvOPQ-9auYBCccQyQ8itoh4Vvwk'; // Updated with your Sheet ID
const SHEET_NAME = 'Sheet1'; // <-- Replace with your Sheet name

exports.handler = async function(event, context) {
  const sheets = await getSheetsClient();

  // Get sheet name from query parameter, default to 'Contracts Database'
  const url = new URL(event.rawUrl || `http://localhost${event.path}${event.rawQuery ? '?' + event.rawQuery : ''}`);
  const sheetName = url.searchParams.get('sheet') || 'Contracts Database';

  try {
    if (event.httpMethod === 'GET') {
      // Read all rows
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: sheetName,
      });
      return {
        statusCode: 200,
        body: JSON.stringify(res.data.values),
      };
    }

    if (event.httpMethod === 'POST') {
      // Add a new row
      const body = JSON.parse(event.body);
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: sheetName,
        valueInputOption: 'RAW',
        resource: { values: [body.row] },
      });
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    if (event.httpMethod === 'PUT') {
      // Edit a row (by index)
      const body = JSON.parse(event.body);
      const { rowIndex, row } = body;
      const range = `${sheetName}!A${rowIndex + 1}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range,
        valueInputOption: 'RAW',
        resource: { values: [row] },
      });
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    if (event.httpMethod === 'DELETE') {
      // Delete a row (by index)
      const body = JSON.parse(event.body);
      const { rowIndex } = body;
      // Find the sheetId for the given sheetName (default to 0 if not found)
      const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const sheetMeta = meta.data.sheets.find(s => s.properties.title === sheetName);
      const sheetId = sheetMeta ? sheetMeta.properties.sheetId : 0;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: sheetId,
                  dimension: 'ROWS',
                  startIndex: rowIndex,
                  endIndex: rowIndex + 1,
                },
              },
            },
          ],
        },
      });
      return { statusCode: 200, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
}; 