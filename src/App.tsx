import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { isNativeMobileApp } from "@/lib/platform";
import Login from "./pages/Login";
import Gallery from "./pages/Gallery";
import Admin from "./pages/Admin";
import UploadPhoto from "./pages/UploadPhoto";
import EventAlbumManagement from "./pages/EventAlbumManagement";
import PublicProfile from "./pages/PublicProfile";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();
const Router = isNativeMobileApp() ? HashRouter : BrowserRouter;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <Router>
          <Routes>
             {/* Public Routes */}
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/:profileSlug" element={<PublicProfile />} />
            <Route path="/:profileSlug/:eventSlug" element={<PublicProfile />} />
            <Route path="/:profileSlug/:eventSlug/:albumSlug" element={<PublicProfile />} />
            
            {/* Private/Authenticated Routes */ }
            
            <Route path="/gallery" element={<Gallery />} />
            <Route path="/upload" element={<UploadPhoto />} />
            <Route path="/manage" element={<EventAlbumManagement />} />
            <Route path="/manage/events/:eventId" element={<EventAlbumManagement />} />
            <Route path="/manage/events/:eventId/albums/:albumId" element={<EventAlbumManagement />} />
            <Route path="/admin" element={<Admin />} />
            
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Router>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
