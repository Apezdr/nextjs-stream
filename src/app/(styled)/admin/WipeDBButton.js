import { buildURL } from "@src/utils"

export default function WipeDbButton() {
  const handleWipeDb = async () => {
    if (window.confirm('Are you sure you want to wipe the database? This action cannot be undone.')) {
      try {
        const response = await fetch(buildURL('/api/authenticated/admin/wipe-db'), {
          method: 'DELETE',
        })
        
        const data = await response.json()
        
        if (response.ok) {
          alert('Database wiped successfully')
        } else {
          throw new Error(data.error || 'Failed to wipe database')
        }
      } catch (error) {
        alert(`Error: ${error.message}`)
      }
    }
  }

  return (
    <button
      onClick={handleWipeDb}
      className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
    >
      Wipe Media from Database
    </button>
  )
}
