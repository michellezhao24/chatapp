import { useState } from 'react';
import Auth from './components/Auth';
import Chat from './components/Chat';
import YouTubeDownload from './components/YouTubeDownload';
import './App.css';

function App() {
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('chatapp_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return localStorage.getItem('chatapp_user'); // legacy: just username string
    }
  });

  const handleLogin = (userData) => {
    const u = typeof userData === 'string' ? { username: userData } : userData;
    localStorage.setItem('chatapp_user', JSON.stringify(u));
    setUser(u);
  };

  const handleLogout = () => {
    localStorage.removeItem('chatapp_user');
    setUser(null);
  };

  if (user) {
    const u = typeof user === 'string' ? { username: user } : user;
    return (
      <Chat
        username={u.username}
        firstName={u.firstName}
        lastName={u.lastName}
        onLogout={handleLogout}
      />
    );
  }
  return <Auth onLogin={handleLogin} />;
}

export default App;
