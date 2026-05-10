import { useState } from "react";
import apiService from "../../services/api";

export const useDataEditor = () => {
  const [data, setData] = useState([]);
  const [columns, setColumns] = useState([]);
  const [fileName, setFileName] = useState("no name");
  const [fileType, setFileType] = useState("no file type");
  const [textContent, setTextContent] = useState("no context");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("no message");
  const [rows, setRows] = useState(0);
  const [cols, setCols] = useState(0);
  const [describe, setDescribe] = useState();
  const [dfHealth, setDfHealth] = useState();
  const [dfImposter, setDfImposter] = useState();
  const [dfOutliers, setDfOutliers] = useState();
  const [dataIntegrity, setDataIntegrity] = useState();

  const loadFileData = (result) => {
    setFileName(result.file_name);
    setFileType(result.file_type);
    console.log(result);
    console.log(fileName);
    if (result.file_type === "text") {
      setTextContent(result.content);
      setData([]);
      setColumns([]);
    } else {
      setData(result.data);
      setColumns(result.columns);
      setCols(result.shape[1]);
      setRows(result.shape[0]);
      setDescribe(result.describe);
      setDfHealth(result.df_health);
      setDfImposter(result.df_imposters);
      setDfOutliers(result.dfOutliers);
      setDataIntegrity(result.column_integrity);

      setTextContent("");
    }
  };

  const saveData = async () => {
    setLoading(true);
    setMessage("");

    try {
      const result = await apiService.saveData(
        data,
        columns,
        fileName,

        fileType,
      );
      setMessage(result.message || "Changes saved successfully!");
      setLoading(false);
    } catch (error) {
      setMessage(`Error: ${error.message}`);
      setLoading(false);
    }
  };

  const saveText = async () => {
    setLoading(true);
    setMessage("");

    try {
      const result = await apiService.saveText(textContent, fileName);
      setMessage(result.message || "Text file saved successfully!");
      setLoading(false);
    } catch (error) {
      setMessage(`Error: ${error.message}`);
      setLoading(false);
    }
  };

  return {
    data,
    setData,
    columns,
    fileName,
    fileType,
    textContent,
    setTextContent,
    loading,
    setLoading,
    message,
    setMessage,
    loadFileData,
    saveData,
    saveText,
    rows,
    cols,
    describe,
    dfHealth,
    dfImposter,
    dfOutliers,
    dataIntegrity,
    // columnType,
  };
};
