
import { useEffect, useRef, useState } from "react";
import "./App.css";

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const VAULT_FOLDER_ID = import.meta.env.VITE_VAULT_FOLDER_ID;
const ALLOWED_EMAIL = import.meta.env.VITE_ALLOWED_EMAIL;
const DRIVE_FILE =
  "https://www.googleapis.com/auth/drive.file";

const GOOGLE_FOLDER_MIME =
  "application/vnd.google-apps.folder";


function formatFileSize(bytes) {
  if (!bytes) return "";

  const value = Number(bytes);

  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];

  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1
  );

  const size = value / Math.pow(1024, index);

  return `${Math.round(size * 10) / 10} ${units[index]}`;
}

function App() {
  const tokenClientRef = useRef(null);
  const previewUrlRef = useRef(null);
  
  const [pickerReady, setPickerReady] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [userEmail, setUserEmail] = useState("");

  const [files, setFiles] = useState([]);
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);

  const [selectedFile, setSelectedFile] = useState(null);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  useEffect(() => {
  if (!accessToken) return;

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      sessionStorage.setItem(
        "vaultHiddenAt",
        Date.now().toString()
      );
      return;
    }

    const hiddenAt = Number(
      sessionStorage.getItem("vaultHiddenAt")
    );

    if (!hiddenAt) return;

    const hiddenFor =
      Date.now() - hiddenAt;

    if (hiddenFor >= 15 * 60 * 1000) {
      handleLogout();
    }

    sessionStorage.removeItem("vaultHiddenAt");
  };

  document.addEventListener(
    "visibilitychange",
    handleVisibilityChange
  );

  return () => {
    document.removeEventListener(
      "visibilitychange",
      handleVisibilityChange
    );
  };
}, [accessToken]);
  useEffect(() => {
  if (!accessToken) return;

  const TIMEOUT = 15 * 60 * 1000;
  let timer;

  const resetTimer = () => {
    clearTimeout(timer);

    timer = setTimeout(() => {
      handleLogout();
    }, TIMEOUT);
  };

  const events = [
    "mousemove",
    "mousedown",
    "keydown",
    "scroll",
    "touchstart",
  ];

  events.forEach((event) => {
    window.addEventListener(event, resetTimer);
  });

  resetTimer();

  return () => {
    clearTimeout(timer);

    events.forEach((event) => {
      window.removeEventListener(event, resetTimer);
    });
  };
}, [accessToken]);
  useEffect(() => {
    const loadGoogleScript = () => {
      if (window.google?.accounts?.oauth2) {
        initializeGoogle();
        return;
      }

      const existingScript = document.querySelector(
        'script[src="https://accounts.google.com/gsi/client"]'
      );

      if (existingScript) {
        existingScript.addEventListener(
          "load",
          initializeGoogle,
          { once: true }
        );
        return;
      }

      const script = document.createElement("script");

      script.src =
        "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = initializeGoogle;

      document.body.appendChild(script);
    };

    const initializeGoogle = () => {
      if (!window.google?.accounts?.oauth2) {
        setError(
          "Google authentication could not be initialized."
        );
        return;
      }

      tokenClientRef.current =
        window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,

          scope: `${DRIVE_FILE}`,

          callback: async (response) => {
            if (response.error) {
              setError(
                response.error_description ||
                  response.error
              );
              return;
            }

            setAccessToken(
              response.access_token
            );

            await verifyUser(
              response.access_token
            );
          },
        });
    };

    loadGoogleScript();
  }, []);

useEffect(() => {
  const loadPicker = () => {
    if (!window.gapi) {
      setError("Google Picker API could not be loaded.");
      return;
    }

    window.gapi.load("picker", {
      callback: () => {
        if (window.google?.picker) {
          setPickerReady(true);
        } else {
          setError("Google Picker library could not be initialized.");
        }
      },
    });
  };

  const existingScript = document.querySelector(
    'script[src="https://apis.google.com/js/api.js"]'
  );

  if (existingScript) {
    if (window.gapi) {
      loadPicker();
    } else {
      existingScript.addEventListener("load", loadPicker, {
        once: true,
      });
    }

    return;
  }

  const script = document.createElement("script");

  script.src = "https://apis.google.com/js/api.js";
  script.async = true;
  script.defer = true;

  script.onload = loadPicker;

  script.onerror = () => {
    setError("Google Picker API could not be loaded.");
  };

  document.body.appendChild(script);

  return () => {
    script.onload = null;
    script.onerror = null;
  };
}, []);
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(
          previewUrlRef.current
        );
      }
    };
  }, []);

  const signIn = () => {
    setError("");

    if (!tokenClientRef.current) {
      setError(
        "Google authentication is still loading."
      );
      return;
    }

    tokenClientRef.current.requestAccessToken({
      prompt: "consent",
    });
  };

  const verifyUser = async (token) => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,photoLink)",
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          "Unable to verify Google account."
        );
      }

      const data = await response.json();

      const email =
        data.user?.emailAddress || "";

      if (
        ALLOWED_EMAIL &&
        email.toLowerCase() !==
          ALLOWED_EMAIL.toLowerCase()
      ) {
        setAccessToken(null);
        setUserEmail("");

        setError(
          "Access denied. This Google account is not authorized."
        );

        if (
          window.google?.accounts?.oauth2
        ) {
          window.google.accounts.oauth2.revoke(
            token,
            () => {}
          );
        }

        return;
      }

      setUserEmail(email);

      await loadVaultFiles(token);
    } catch (err) {
      console.error(err);

      setError(
        err.message ||
          "Unable to verify Google account."
      );

      setAccessToken(null);
    } finally {
      setLoading(false);
    }
  };

  const loadVaultFiles = async (
    token,
    folderId = VAULT_FOLDER_ID
  ) => {
    try {
      setLoading(true);
      setError("");

      const query = encodeURIComponent(
        `'${folderId}' in parents and trashed = false`
      );

      const fields = encodeURIComponent(
        "files(id,name,mimeType,size,modifiedTime,webViewLink,iconLink,parents)"
      );

      const url =
        "https://www.googleapis.com/drive/v3/files" +
        `?q=${query}` +
        `&fields=${fields}` +
        "&orderBy=name" +
        "&pageSize=100";

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const message =
          await response.text();

        throw new Error(
          message ||
            "Could not load your vault."
        );
      }

      const data = await response.json();

      const allItems = data.files || [];

      const folderItems =
        allItems.filter(
          (item) =>
            item.mimeType ===
            GOOGLE_FOLDER_MIME
        );

      const fileItems =
        allItems.filter(
          (item) =>
            item.mimeType !==
            GOOGLE_FOLDER_MIME
        );

      setFolders(folderItems);
      setFiles(fileItems);

      setCurrentFolder(
        folderId === VAULT_FOLDER_ID
          ? null
          : folderId
      );
    } catch (err) {
      console.error(err);

      setError(
        "Could not load this folder."
      );
    } finally {
      setLoading(false);
    }
  };

  const searchVault = async (term) => {
    setSearchTerm(term);

    if (!term.trim()) {
      setSearchResults([]);
      return;
    }

    if (!accessToken) {
      return;
    }

    try {
      setLoading(true);
      setError("");

      /*
       * At the vault root:
       * search only the five first-level vault folders.
       *
       * Inside a category:
       * search only that category.
       *
       * This intentionally does NOT perform a
       * whole-Drive search.
       */

      const foldersToSearch = currentFolder
        ? [
            {
              id: currentFolder,
              name: "Current category",
            },
          ]
        : folders;

      if (foldersToSearch.length === 0) {
        setSearchResults([]);
        return;
      }

      const safeTerm = term
        .trim()
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");

      const results = await Promise.all(
        foldersToSearch.map(
          async (folder) => {
            const query =
              encodeURIComponent(
                `'${folder.id}' in parents and ` +
                  `name contains '${safeTerm}' and ` +
                  `trashed = false`
              );

            const fields =
              encodeURIComponent(
                "files(id,name,mimeType,size,modifiedTime,parents)"
              );

            const url =
              "https://www.googleapis.com/drive/v3/files" +
              `?q=${query}` +
              `&fields=${fields}` +
              "&orderBy=name" +
              "&pageSize=100";

            const response =
              await fetch(url, {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              });

            if (!response.ok) {
              throw new Error(
                "Unable to search vault."
              );
            }

            const data =
              await response.json();

            return (
              data.files || []
            ).map((file) => ({
              ...file,
              category:
                folder.name || "",
            }));
          }
        )
      );

      const combinedResults =
        results
          .flat()
          .filter(
            (file) =>
              file.mimeType !==
              GOOGLE_FOLDER_MIME
          );

      setSearchResults(
        combinedResults
      );
    } catch (err) {
      console.error(err);

      setSearchResults([]);

      setError(
        "Search failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const downloadFile = async (file) => {
    try {
      setError("");

      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          "Unable to download file."
        );
      }

      const blob =
        await response.blob();

      const url =
        window.URL.createObjectURL(
          blob
        );

      const anchor =
        document.createElement("a");

      anchor.href = url;
      anchor.download = file.name;

      document.body.appendChild(
        anchor
      );

      anchor.click();

      anchor.remove();

      window.URL.revokeObjectURL(
        url
      );
    } catch (err) {
      console.error(err);
      setError("Download failed.");
    }
  };

  const previewFile = async (file) => {
    try {
      setError("");

      if (
        file.mimeType ===
          "application/pdf" ||
        file.mimeType?.startsWith(
          "image/"
        )
      ) {
        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error(
            "Unable to preview file."
          );
        }

        const blob =
          await response.blob();

        if (previewUrlRef.current) {
          URL.revokeObjectURL(
            previewUrlRef.current
          );
        }

        const url =
          window.URL.createObjectURL(
            blob
          );

        previewUrlRef.current = url;

        setSelectedFile({
          ...file,
          previewUrl: url,
        });

        return;
      }

      if (file.webViewLink) {
        window.open(
          file.webViewLink,
          "_blank",
          "noopener,noreferrer"
        );
      } else {
        setError(
          "Preview is not available for this file type."
        );
      }
    } catch (err) {
      console.error(err);
      setError("Preview failed.");
    }
  };

  const closePreview = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(
        previewUrlRef.current
      );
      previewUrlRef.current = null;
    }

    setSelectedFile(null);
  };
const openGooglePicker = () => {
  if (!accessToken) {
    setError(
      "Please sign in first."
    );
    return;
  }

  if (!pickerReady) {
    setError(
      "Google Picker is still loading."
    );
    return;
  }

  const view =
    new window.google.picker.DocsView(
      window.google.picker.ViewId.DOCS
    );

  view.setIncludeFolders(true);
  view.setSelectFolderEnabled(true);

  const picker =
    new window.google.picker.PickerBuilder()
      .setDeveloperKey(
        import.meta.env
          .VITE_GOOGLE_PICKER_API_KEY
      )
      .setAppId(
        import.meta.env
          .VITE_GOOGLE_PROJECT_NUMBER
      )
      .setOAuthToken(accessToken)
      .addView(view)
      .setTitle(
        "Select a Personal Vault folder"
      )
      .setCallback(
        handlePickerCallback
      )
      .build();

  picker.setVisible(true);
};

const handlePickerCallback = async (
  data
) => {
  if (
    data.action !==
    window.google.picker.Action.PICKED
  ) {
    return;
  }

  const documents =
    data[
      window.google.picker.Response.DOCUMENTS
    ];

  if (
    !documents ||
    documents.length === 0
  ) {
    return;
  }

  const selected =
    documents[0];

  const selectedFolderId =
    selected[
      window.google.picker.Document.ID
    ];

  console.log(
    "Picker selected:",
    selectedFolderId
  );

  /*
   * For now we only verify the selected
   * folder. We will connect this to
   * PERSONAL VAULT authorization in
   * the next step.
   */

  if (
    selectedFolderId ===
    VAULT_FOLDER_ID
  ) {
    setError("");

    await loadVaultFiles(
      accessToken,
      VAULT_FOLDER_ID
    );

    return;
  }

  setError(
    "Please select your Personal Vault folder."
  );
};
  const handleUpload = async (
    event,
    destinationFolderId = null
  ) => {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    const targetFolder =
      destinationFolderId ||
      currentFolder ||
      VAULT_FOLDER_ID;

    try {
      setUploading(true);
      setUploadProgress(0);
      setUploadFileName(file.name);
      setUploadError("");
      setError("");

      /*
       * Create a Google Drive resumable
       * upload session.
       */

      const metadata = {
        name: file.name,
        mimeType:
          file.type ||
          "application/octet-stream",
        parents: [targetFolder],
      };

      const initResponse =
        await fetch(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${accessToken}`,

              "Content-Type":
                "application/json; charset=UTF-8",

              "X-Upload-Content-Type":
                file.type ||
                "application/octet-stream",

              "X-Upload-Content-Length":
                String(file.size),
            },

            body: JSON.stringify(
              metadata
            ),
          }
        );

      if (!initResponse.ok) {
        const message =
          await initResponse.text();

        throw new Error(
          message ||
            "Could not create upload session."
        );
      }

      const uploadUrl =
        initResponse.headers.get(
          "Location"
        );

      if (!uploadUrl) {
        throw new Error(
          "Google did not return an upload URL."
        );
      }

      /*
       * Upload directly from the browser
       * to Google Drive.
       */

      await new Promise(
        (resolve, reject) => {
          const xhr =
            new XMLHttpRequest();

          xhr.open(
            "PUT",
            uploadUrl,
            true
          );

          xhr.setRequestHeader(
            "Content-Type",
            file.type ||
              "application/octet-stream"
          );

          xhr.upload.onprogress = (
            progressEvent
          ) => {
            if (
              progressEvent.lengthComputable
            ) {
              const percent =
                Math.round(
                  (progressEvent.loaded /
                    progressEvent.total) *
                    100
                );

              setUploadProgress(
                percent
              );
            }
          };

          xhr.onload = () => {
            if (
              xhr.status === 200 ||
              xhr.status === 201
            ) {
              resolve();
            } else {
              reject(
                new Error(
                  `Upload failed with status ${xhr.status}`
                )
              );
            }
          };

          xhr.onerror = () => {
            reject(
              new Error(
                "Network error during upload."
              )
            );
          };

          xhr.onabort = () => {
            reject(
              new Error(
                "Upload was cancelled."
              )
            );
          };

          xhr.send(file);
        }
      );

      setUploadProgress(100);

      /*
       * Refresh the currently open folder.
       */

      await loadVaultFiles(
        accessToken,
        currentFolder ||
          VAULT_FOLDER_ID
      );

      event.target.value = "";

      setShowUploadMenu(false);

      setTimeout(() => {
        setUploadProgress(0);
        setUploadFileName("");
      }, 1200);
    } catch (err) {
      console.error(
        "Upload error:",
        err
      );

      setUploadError(
        err.message ||
          "Upload failed."
      );

      setError(
        "Upload failed. Your document was not added."
      );
    } finally {
      setUploading(false);
    }
  };

  const logout = () => {
    if (
      accessToken &&
      window.google?.accounts?.oauth2
    ) {
      window.google.accounts.oauth2.revoke(
        accessToken,
        () => {}
      );
    }

    closePreview();

    setAccessToken(null);
    setUserEmail("");

    setFiles([]);
    setFolders([]);

    setCurrentFolder(null);

    setSearchTerm("");
    setSearchResults([]);

    setUploading(false);
    setUploadProgress(0);
    setUploadFileName("");
    setUploadError("");

    setShowUploadMenu(false);
    setError("");
  };

  if (!accessToken) {
    return (
      <div className="login-page">
        <div className="login-card">

          <div className="vault-icon">
            🔐
          </div>

          <h1>
            Personal Vault
          </h1>

          <p>
            Your important documents,
            securely accessed from your
            private Google Drive.
          </p>

          <button
            className="google-button"
            onClick={signIn}
            disabled={loading}
          >
            {loading
              ? "Checking..."
              : "Continue with Google"}
          </button>

          {error && (
            <div className="error">
              {error}
            </div>
          )}

          <div className="security-note">
            <span>🔒</span>

            <div>
              <strong>
                Your files stay in
                Google Drive
              </strong>

              <small>
                This website does not
                store your documents.
              </small>
            </div>
          </div>

        </div>
      </div>
    );
  }

  return (
    <div className="app">

      <header className="topbar">

        <div className="brand">

          <div className="brand-icon">
            🔐
          </div>

          <div>
            <h2>
              Personal Vault
            </h2>

            <span>
              Private document access
            </span>
          </div>

        </div>

        <div className="account">

          <span>
            {userEmail}
          </span>

          <button
            className="logout"
            onClick={logout}
          >
            Lock
          </button>
         
        </div>

      </header>

      <main className="container">

        {/* SEARCH */}

        <div className="search-bar">

          <span className="search-icon">
            🔎
          </span>

          <input
            type="text"
            placeholder="Search your vault..."
            value={searchTerm}
            onChange={(event) =>
              searchVault(
                event.target.value
              )
            }
          />

          {searchTerm && (
            <button
              type="button"
              className="clear-search"
              onClick={() => {
                setSearchTerm("");
                setSearchResults([]);
              }}
            >
              ✕
            </button>
          )}

        </div>

        {/* SEARCH RESULTS */}

        {searchTerm && (
          <section className="search-results">

            <div className="section-header">

              <div>

                <span className="eyebrow">
                  SEARCH
                </span>

                <h2>
                  Results for "
                  {searchTerm}"
                </h2>

                <p className="search-scope">
                  {currentFolder
                    ? "Searching this category"
                    : "Searching your Personal Vault"}
                </p>

              </div>

              <span className="result-count">
                {searchResults.length}{" "}
                result
                {searchResults.length !==
                1
                  ? "s"
                  : ""}
              </span>

            </div>

            {loading ? (

              <div className="empty search-empty">

                <div>🔎</div>

                <h3>
                  Searching your vault...
                </h3>

                <p>
                  Looking through your
                  documents.
                </p>

              </div>

            ) : searchResults.length ===
              0 ? (

              <div className="empty search-empty">

                <div>🔎</div>

                <h3>
                  No documents found
                </h3>

                <p>
                  Try another document
                  name.
                </p>

              </div>

            ) : (

              <div className="file-grid">

                {searchResults.map(
                  (file) => (

                    <div
                      className="file-card"
                      key={file.id}
                    >

                      <div className="file-icon">

                        {file.mimeType ===
                        "application/pdf"
                          ? "PDF"
                          : file.mimeType?.startsWith(
                              "image/"
                            )
                          ? "IMG"
                          : "FILE"}

                      </div>

                      <div className="file-info">

                        <h3
                          title={
                            file.name
                          }
                        >
                          {file.name}
                        </h3>

                        <p>
                          {file.mimeType}
                        </p>

                        <small>
                          {file.modifiedTime
                            ? new Date(
                                file.modifiedTime
                              ).toLocaleDateString()
                            : ""}

                          {file.size
                            ? ` • ${formatFileSize(
                                file.size
                              )}`
                            : ""}
                        </small>

                        {file.category && (
                          <div className="search-result-category">
                            📁{" "}
                            {file.category}
                          </div>
                        )}

                      </div>

                      <div className="file-actions">

                        <button
                          type="button"
                          onClick={() =>
                            previewFile(
                              file
                            )
                          }
                        >
                          👁 Preview
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            downloadFile(
                              file
                            )
                          }
                        >
                          ↓ Download
                        </button>

                      </div>

                    </div>

                  )
                )}

              </div>

            )}

          </section>
        )}

        {/* HERO */}

        {!searchTerm && (
          <section className="hero">

            <div>

              <span className="eyebrow">
                PRIVATE DOCUMENT VAULT
              </span>

              <h1>
                Your documents.
                <br />
                Your Drive.
              </h1>

              <p>
                Access important documents
                without moving them out of
                Google Drive.
              </p>

            </div>

            <div className="upload-wrapper">

              {currentFolder ? (

                <label className="upload-button">

                  {uploading
                    ? "Uploading..."
                    : "+ Upload Document"}

                  <input
                    type="file"
                    hidden
                    disabled={uploading}
                    onChange={(
                      event
                    ) =>
                      handleUpload(
                        event,
                        currentFolder
                      )
                    }
                  />

                </label>

              ) : (

                <>
                  <button
                    type="button"
                    className="upload-button"
                    onClick={() =>
                      setShowUploadMenu(
                        (value) =>
                          !value
                      )
                    }
                    disabled={uploading}
                  >
                    {uploading
                      ? "Uploading..."
                      : "+ Upload Document"}
                  </button>
{showUploadMenu && (
  <div className="upload-menu">

    <div className="upload-menu-title">
      Upload to
    </div>

    {folders.map((folder) => (
      <div
        className="upload-folder-item"
        key={folder.id}
      >
        <button
          type="button"
          className="upload-folder-button"
          disabled={uploading}
          onClick={() => {
            document
              .getElementById(`upload-${folder.id}`)
              ?.click();
          }}
        >
          <span>📁</span>
          <span>{folder.name}</span>
        </button>

        <input
          id={`upload-${folder.id}`}
          type="file"
          hidden
          disabled={uploading}
          onChange={(event) => {
            setShowUploadMenu(false);
            handleUpload(event, folder.id);
          }}
        />
      </div>
    ))}

  </div>
)}

                </>

              )}

            </div>

          </section>
        )}

        {error && (
          <div className="error-banner">
            {error}
          </div>
        )}

        {uploadError && (
          <div className="error-banner">
            {uploadError}
          </div>
        )}

        {/* STATS */}

        {!searchTerm && (
          <section className="stats">

            <div>
              <strong>
                {currentFolder
                  ? files.length
                  : folders.length}
              </strong>

              <span>
                {currentFolder
                  ? "Documents"
                  : "Categories"}
              </span>
            </div>

            <div>
              <strong>
                Drive
              </strong>

              <span>
                Storage
              </span>
            </div>

            <div>
              <strong>
                Private
              </strong>

              <span>
                Access
              </span>
            </div>

          </section>
        )}

        {/* UPLOAD PROGRESS */}

        {uploading && (
          <div className="upload-progress-card">

            <div className="upload-progress-top">

              <div>

                <span className="eyebrow">
                  UPLOADING
                </span>

                <h3>
                  {uploadFileName}
                </h3>

              </div>

              <strong>
                {uploadProgress}%
              </strong>

            </div>

            <div className="progress-track">

              <div
                className="progress-fill"
                style={{
                  width:
                    `${uploadProgress}%`,
                }}
              />

            </div>

            <p>
              Uploading directly to your
              Google Drive vault...
            </p>

          </div>
        )}

        {/* DOCUMENTS */}

        {!searchTerm && (
          <section className="documents">

            <div className="section-header">

              <div>

                <span className="eyebrow">
                  PERSONAL VAULT
                </span>

                <h2>
                  {currentFolder
                    ? "Documents"
                    : "Categories"}
                </h2>

              </div>

              <div className="section-actions">

                {currentFolder && (
                  <button
                    type="button"
                    onClick={() =>
                      loadVaultFiles(
                        accessToken,
                        VAULT_FOLDER_ID
                      )
                    }
                  >
                    ← Back
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    loadVaultFiles(
                      accessToken,
                      currentFolder ||
                        VAULT_FOLDER_ID
                    )
                  }
                >
                  ↻ Refresh
                </button>

              </div>

            </div>

            {loading ? (

              <div className="empty">
                Loading your vault...
              </div>

            ) : (

              <>

                {/* ROOT CATEGORY FOLDERS */}

                {!currentFolder && (
                  <div className="folder-grid">

                    {folders.map(
                      (folder) => (

                        <button
                          type="button"
                          className="folder-card"
                          key={folder.id}
                          onClick={() =>
                            loadVaultFiles(
                              accessToken,
                              folder.id
                            )
                          }
                        >

                          <div className="folder-icon">
                            📁
                          </div>

                          <div>

                            <h3>
                              {folder.name}
                            </h3>

                            <p>
                              Open folder
                            </p>

                          </div>

                          <span className="folder-arrow">
                            →
                          </span>

                        </button>

                      )
                    )}

                  </div>
                )}

                {/* FILES INSIDE CATEGORY */}

                {currentFolder && (
                  files.length === 0 ? (

                    <div className="empty">

                      <div>
                        📂
                      </div>

                      <h3>
                        No documents here
                      </h3>

                      <p>
                        Upload a document to
                        this category.
                      </p>

                    </div>

                  ) : (

                    <div className="file-grid">

                      {files.map(
                        (file) => (

                          <div
                            className="file-card"
                            key={file.id}
                          >

                            <div className="file-icon">

                              {file.mimeType ===
                              "application/pdf"
                                ? "PDF"
                                : file.mimeType?.startsWith(
                                    "image/"
                                  )
                                ? "IMG"
                                : "FILE"}

                            </div>

                            <div className="file-info">

                              <h3
                                title={
                                  file.name
                                }
                              >
                                {file.name}
                              </h3>

                              <p>
                                {file.mimeType}
                              </p>

                              <small>
                                {file.modifiedTime
                                  ? new Date(
                                      file.modifiedTime
                                    ).toLocaleDateString()
                                  : ""}

                                {file.size
                                  ? ` • ${formatFileSize(
                                      file.size
                                    )}`
                                  : ""}
                              </small>

                            </div>

                            <div className="file-actions">

                              <button
                                type="button"
                                onClick={() =>
                                  previewFile(
                                    file
                                  )
                                }
                              >
                                👁 Preview
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  downloadFile(
                                    file
                                  )
                                }
                              >
                                ↓ Download
                              </button>

                            </div>

                          </div>

                        )
                      )}

                    </div>

                  )
                )}

              </>

            )}

          </section>
        )}

      </main>

      {/* PREVIEW MODAL */}

      {selectedFile && (
        <div
          className="preview-overlay"
          onClick={closePreview}
        >

          <div
            className="preview-modal"
            onClick={(event) =>
              event.stopPropagation()
            }
          >

            <div className="preview-header">

              <strong>
                {selectedFile.name}
              </strong>

              <button
                type="button"
                onClick={closePreview}
              >
                ✕
              </button>

            </div>

            {selectedFile.mimeType ===
            "application/pdf" ? (

              <iframe
                src={
                  selectedFile.previewUrl
                }
                title={
                  selectedFile.name
                }
              />

            ) : (

              <img
                src={
                  selectedFile.previewUrl
                }
                alt={
                  selectedFile.name
                }
              />

            )}

          </div>

        </div>
      )}

    </div>
  );
}

export default App;
