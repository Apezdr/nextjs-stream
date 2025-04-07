import { isAdminOrWebhook } from '../../../../utils/routeAuth'
import { fetchAllServerData } from '@src/utils/fetchAllServerData';

export const GET = async (req) => {
  const authResult = await isAdminOrWebhook(req);
  if (authResult instanceof Response) {
    return authResult;
  }

  try {
    const { fileServers, errors } = await fetchAllServerData();

    return new Response(
      JSON.stringify({
        fileServers,
        errors: errors.length > 0 ? errors : undefined
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Failed to sync data:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to sync data',
        details: error.message
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};