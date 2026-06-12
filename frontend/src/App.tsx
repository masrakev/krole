import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { Landing } from "./components/Landing";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/app" element={<AppLayout />} />
    </Routes>
  );
}

export default App;
