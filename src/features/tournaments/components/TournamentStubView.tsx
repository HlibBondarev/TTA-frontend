import React from "react";
import { useDispatch } from "react-redux";
import { navigateToHub } from "../../../store/slices/navigationSlice";

export const TournamentStubView: React.FC = () => {
  const dispatch = useDispatch();

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col flex-1 p-4 bg-gray-950 text-gray-100 overflow-y-auto">
      <header className="flex items-center justify-between pb-3 border-b border-gray-800 mb-4">
        <h2 className="text-sm font-black uppercase text-purple-400 tracking-wider">
          Tournaments Feature
        </h2>
        <button
          type="button"
          onClick={() => dispatch(navigateToHub())}
          className="text-xs bg-gray-900 hover:bg-gray-800 text-gray-300 px-3 py-1 rounded border border-gray-700 transition-colors"
        >
          Back to Menu
        </button>
      </header>

      <div className="flex-1 space-y-4">
        <div className="p-3 bg-purple-950/30 border border-purple-800/50 rounded-xl">
          <span className="inline-block px-2 py-0.5 text-[10px] uppercase font-bold bg-purple-900 text-purple-200 rounded mb-2">
            Feature in Development
          </span>
          <p className="text-xs text-gray-300 leading-relaxed">
            Tournament Management provides structural governance for sports
            organizations, clubs, and official matches based on security scopes
            and application roles.
          </p>
        </div>

        {/* Target Scope Information */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase text-gray-400">
            Target Scopes (TargetScope)
          </h3>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            <div className="p-2 bg-gray-900 border border-gray-800 rounded-lg">
              <div className="text-xs font-bold text-white">Global</div>
              <div className="text-[9px] text-gray-500">System level</div>
            </div>
            <div className="p-2 bg-gray-900 border border-gray-800 rounded-lg">
              <div className="text-xs font-bold text-white">Club</div>
              <div className="text-[9px] text-gray-500">Organization</div>
            </div>
            <div className="p-2 bg-gray-900 border border-gray-800 rounded-lg">
              <div className="text-xs font-bold text-white">Team</div>
              <div className="text-[9px] text-gray-500">Squad context</div>
            </div>
          </div>
        </div>

        {/* App Role Permissions */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold uppercase text-gray-400">
            Permission Roles (AppRole)
          </h3>
          <ul className="space-y-1.5 text-xs">
            <li className="p-2 bg-gray-900 border border-gray-800 rounded-lg flex justify-between items-center">
              <span className="font-semibold text-emerald-400">
                FullControl
              </span>
              <span className="text-[10px] text-gray-400">
                Full CRUD & Staff Admin
              </span>
            </li>
            <li className="p-2 bg-gray-900 border border-gray-800 rounded-lg flex justify-between items-center">
              <span className="font-semibold text-blue-400">Editor</span>
              <span className="text-[10px] text-gray-400">
                Record matches & TTA
              </span>
            </li>
            <li className="p-2 bg-gray-900 border border-gray-800 rounded-lg flex justify-between items-center">
              <span className="font-semibold text-gray-400">Viewer</span>
              <span className="text-[10px] text-gray-400">
                Read-only statistics
              </span>
            </li>
          </ul>
        </div>
      </div>

      <footer className="pt-4 border-t border-gray-800 mt-auto">
        <button
          type="button"
          onClick={() => dispatch(navigateToHub())}
          className="w-full py-3 bg-gray-900 hover:bg-gray-800 text-gray-200 font-bold text-xs uppercase rounded-xl transition-colors border border-gray-700"
        >
          Return to Hub
        </button>
      </footer>
    </div>
  );
};
