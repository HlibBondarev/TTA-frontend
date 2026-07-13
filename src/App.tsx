import { useEffect } from "react"; // Removed explicit 'React' import
import { useAppDispatch } from "./store/hooks";
import { setActiveMatch } from "./features/matches/matchSlice";
import { MatchLifecyclePanel } from "./features/matches/components/MatchLifecyclePanel";

function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Seed a standard match UUID to test the local workflow
    dispatch(setActiveMatch("8ce147f2-1b32-4bf1-bf19-3351a94fe110"));
  }, [dispatch]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center p-4">
      <header className="mb-4 text-center">
        <h1 className="text-xl font-black text-white tracking-tight uppercase">
          TTA-Board Sandbox
        </h1>
        <p className="text-xs text-gray-500 font-medium">
          Feature-Driven Component Sandboxing
        </p>
      </header>

      <MatchLifecyclePanel />
    </div>
  );
}

export default App;
