'use client'
import { useState } from 'react'
import { toast } from 'react-toastify'

export default function AutoSyncToggle({ checked }) {
  const [isChecked, setIsChecked] = useState(checked)

  const handleToggle = () => {
    setIsChecked(!isChecked)
    toast.success(<div className='flex flex-col'><span className='font-bold'>{`Auto sync ${!isChecked ? 'enabled' : 'disabled'}`}</span><span className='text-xs'>{new Date().toLocaleString()}</span></div>, {
      //position: "bottom-right",
      autoClose: 3000,
      hideProgressBar: true,
      closeOnClick: true,
      pauseOnHover: true,
      draggable: true,
    })
  }

  return (
    <dd className="flex flex-auto items-center justify-end">
    <input type="hidden" name="automaticSyncEnabled" value={isChecked} />
    <button
        type="submit"
        className={`group flex w-8 cursor-pointer rounded-full bg-gray-200 p-px ring-1 ring-inset ring-gray-900/5 transition-colors duration-200 ease-in-out focus:outline-none ${isChecked ? 'bg-indigo-600' : 'bg-gray-200'}`}
        onClick={handleToggle}
    >
        <span
        aria-hidden="true"
        className={`h-4 w-4 transform rounded-full bg-white shadow-sm ring-1 ring-gray-900/5 transition duration-200 ease-in-out ${isChecked ? 'translate-x-3.5' : 'translate-x-0'}`}
        />
    </button>
    </dd>
  )
}
