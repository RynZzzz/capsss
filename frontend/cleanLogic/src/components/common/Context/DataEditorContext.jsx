import { useContext, createContext } from "react";

export const DataEditorContext = createContext();

export const useGlobalDataEditor = () => {
  const context = useContext(DataEditorContext);
  if (!context) {
    throw new Error(
      "useGlobalDataEditor must be within the DataEditorProvider",
    );
  }
  return context;
};
