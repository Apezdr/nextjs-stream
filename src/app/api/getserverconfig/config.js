'use server'
import { multiServerHandler } from "@src/utils/config"

export async function getServerConfig() {
    const handler = multiServerHandler.getHandler("default")
    const defaultFileServer = handler.createFullURL('', true)
    return {
      server: process.env.NEXT_PUBLIC_BASE_URL,
      defaultFileServer: defaultFileServer,
    }
}