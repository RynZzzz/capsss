import { DataEditorContext } from "../common/Context/DataEditorContext";
import { useDataEditor } from "./useDataEditor";

export const DataEditorProvider = ({ children }) => {
  const editor = useDataEditor();

  return (
    <DataEditorContext.Provider value={editor}>
      {children}
    </DataEditorContext.Provider>
  );
};
