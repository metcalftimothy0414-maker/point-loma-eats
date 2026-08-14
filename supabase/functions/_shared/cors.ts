// Mobile clients (React Native) don't need this, but a browser-based caller
// (e.g. a future web checkout, or testing from the admin app) does.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
