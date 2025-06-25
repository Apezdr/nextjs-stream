import { isAdminOrWebhook } from '../../../../utils/routeAuth'
import { getFileServerData } from '@src/utils/fileServerDataService';

export const GET = async (req) => {
  const authResult = await isAdminOrWebhook(req);
  if (authResult instanceof Response) {
    return authResult;
  }

  try {
    const data = await getFileServerData();
    
    return new Response(
      JSON.stringify(data),
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
