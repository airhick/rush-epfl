import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { motion } from 'motion/react';
import { useMe } from '../lib/queries';
import { useRealtime } from '../lib/realtime';
import { useApplyTheme } from '../lib/theme';
import { useGeo } from '../state/location';
import { Shell } from './Shell';
import { Login, Onboarding } from '../screens/Login';
import { Explore } from '../screens/Explore';
import { SpotScreen } from '../screens/SpotScreen';
import { Checkout } from '../screens/Checkout';
import { OrderScreen } from '../screens/OrderScreen';
import { Orders } from '../screens/Orders';
import { Deliver } from '../screens/Deliver';
import { Messages } from '../screens/Messages';
import { Chat } from '../screens/Chat';
import { Wallet } from '../screens/Wallet';
import { Profile } from '../screens/Profile';
import { Owners } from '../screens/Owners';
import { Logo } from '../ui/Logo';

export function App() {
  useApplyTheme();
  const { data: me, isLoading } = useMe();
  useRealtime(me);

  useEffect(() => {
    if (me) useGeo.getState().start();
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="splash">
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 }}>
          <Logo size={34} />
        </motion.div>
      </div>
    );
  }

  if (!me) {
    return (
      <Shell chrome={false}>
        <Login />
      </Shell>
    );
  }

  if (!me.onboarded) {
    return (
      <Shell chrome={false}>
        <Onboarding me={me} />
      </Shell>
    );
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Explore />} />
        <Route path="spot/:id" element={<SpotScreen />} />
        <Route path="checkout" element={<Checkout />} />
        <Route path="orders" element={<Orders />} />
        <Route path="orders/:id" element={<OrderScreen />} />
        <Route path="deliver" element={<Deliver />} />
        <Route path="messages" element={<Messages />} />
        <Route path="messages/:id" element={<Chat />} />
        <Route path="wallet" element={<Wallet />} />
        <Route path="profile" element={<Profile />} />
        <Route path="admin" element={<Owners />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
