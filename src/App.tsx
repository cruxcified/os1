import { Toaster } from "sonner";
import { Companion } from "./components/Companion";

function App() {
  return (
    <>
      <Companion />
      <Toaster position="top-center" theme="dark" />
    </>
  );
}

export default App;
