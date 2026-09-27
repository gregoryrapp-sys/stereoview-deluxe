export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // x-region: the client pins every function to us-east-1 (beside the
  // database). A header the preflight does not list is a request the browser
  // never sends, and the site went dark until it was added here.
  'Access-Control-Allow-Headers':
    'authorization, apikey, x-client-info, content-type, x-region',
  'Access-Control-Allow-Methods': 'POST, GET, PUT, OPTIONS',
};