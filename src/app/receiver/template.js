import Script from 'next/script';
import './css/receiver.css';

export default function ReceiverTemplate({ children }) {
  return (
    <>
      <Script src="//www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js" strategy='beforeInteractive' />
      <Script src="//www.gstatic.com/cast/sdk/libs/devtools/debug_layer/caf_receiver_logger.js" strategy='beforeInteractive'/>
      {children}
    </>
  );
}
