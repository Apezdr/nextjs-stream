import { getSession } from '@src/lib/cachedAuth'

export default async function CollectionLayout({ children }) {
  const session = await getSession()
  
  return (
    <div className={session?.user ? "bg-gray-950" : ""}>
      {children}
    </div>
  );
}