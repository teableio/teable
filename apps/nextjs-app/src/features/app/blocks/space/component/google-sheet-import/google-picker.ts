/**
 * Thin loader around Google's Picker widget (the only Google JS this app
 * loads). The Picker is the heart of the drive.file permission model: the app
 * can only read spreadsheets the user hand-picks here, so no restricted Drive
 * scope (and no Google security assessment) is ever needed.
 *
 * Local dev gotcha: the picker derives its `origin`/`hostId` from
 * window.location, and Google rejects IP-literal origins with a bare
 * "403. That's an error." page from docs.google.com. Browse the app on
 * http://localhost:<port>, never http://127.0.0.1:<port> (and never a
 * *.localhost branch subdomain, which Google's OAuth client won't accept as a
 * redirect URI either).
 */

const pickerScriptUrl = 'https://apis.google.com/js/api.js';
const spreadsheetsViewId = 'spreadsheets';

export interface IGooglePickedDoc {
  id: string;
  name?: string;
  mimeType?: string;
}

interface IGooglePickerResponse {
  action: string;
  docs?: IGooglePickedDoc[];
}

interface IGooglePicker {
  setVisible: (visible: boolean) => void;
  dispose?: () => void;
}

interface IGooglePickerBuilder {
  addView: (view: unknown) => IGooglePickerBuilder;
  setOAuthToken: (token: string) => IGooglePickerBuilder;
  setDeveloperKey: (key: string) => IGooglePickerBuilder;
  setAppId: (appId: string) => IGooglePickerBuilder;
  setLocale: (locale: string) => IGooglePickerBuilder;
  enableFeature: (feature: string) => IGooglePickerBuilder;
  setCallback: (callback: (response: IGooglePickerResponse) => void) => IGooglePickerBuilder;
  build: () => IGooglePicker;
}

interface IGooglePickerApi {
  PickerBuilder: new () => IGooglePickerBuilder;
  DocsView: new (viewId?: string) => unknown;
  Action: { PICKED: string; CANCEL: string };
  Feature: { MULTISELECT_ENABLED: string };
}

interface IGoogleApiWindow {
  gapi?: { load: (name: string, callback: () => void) => void };
  google?: { picker?: IGooglePickerApi };
}

let pickerApiPromise: Promise<IGooglePickerApi> | undefined;

const loadPickerApi = (): Promise<IGooglePickerApi> => {
  // Cache the load across dialog opens; reset on failure so a transient
  // network error (or an unblocked blocker) can be retried.
  pickerApiPromise ??= new Promise<IGooglePickerApi>((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      pickerApiPromise = undefined;
      reject(new Error(message));
    };
    // gapi.load('picker', cb) can silently never call back (e.g. an ad
    // blocker allows api.js but blocks the picker module); without a timeout
    // the cached pending promise wedges every caller until a page reload.
    const loadTimer = setTimeout(
      () => fail('Timed out loading the Google Picker (blocked by the network or an extension?)'),
      20_000
    );
    const win = window as unknown as IGoogleApiWindow;
    const onGapiReady = () => {
      win.gapi!.load('picker', () => {
        const picker = win.google?.picker;
        if (picker && !settled) {
          settled = true;
          clearTimeout(loadTimer);
          resolve(picker);
        } else if (!picker) {
          fail('Google Picker failed to initialize');
        }
      });
    };
    if (win.gapi) {
      onGapiReady();
      return;
    }
    const script = document.createElement('script');
    script.src = pickerScriptUrl;
    script.async = true;
    script.onload = () => {
      if (win.gapi) {
        onGapiReady();
      } else {
        fail('Google API script loaded without gapi');
      }
    };
    script.onerror = () =>
      fail('Failed to load the Google Picker script (blocked by the network or an extension?)');
    document.head.appendChild(script);
  });
  return pickerApiPromise;
};

/**
 * Warm the Picker script cache ahead of the actual pick. Loading
 * apis.google.com/js/api.js plus the picker module is the dominant cold-start
 * cost (seconds on a cold cache) and happens with no visible feedback, so
 * callers fire this as soon as their UI appears — by the time the user reaches
 * the pick button the script is ready and the picker opens near-instantly.
 * Failures are swallowed: the real open retries the load and surfaces errors.
 */
export const preloadPickerApi = (): void => {
  void loadPickerApi().catch(() => undefined);
};

/**
 * Opens the Picker over spreadsheets only and resolves with the picked files,
 * or undefined when the user cancels. Picking is what grants the drive.file
 * OAuth token access to the spreadsheets — the grant is long-lived, so files
 * picked once can be imported again later (chat / CLI) without reopening the
 * Picker.
 *
 * multiSelect: the import dialog keeps single-select (its wizard operates on
 * ONE spreadsheet); the chat picker enables it, because there picking means
 * GRANTING — the agent takes every picked file and imports them one by one.
 */
export const openSpreadsheetPicker = async (params: {
  accessToken: string;
  apiKey: string;
  appId: string;
  locale?: string;
  multiSelect?: boolean;
}): Promise<IGooglePickedDoc[] | undefined> => {
  const { accessToken, apiKey, appId, locale, multiSelect } = params;
  const pickerApi = await loadPickerApi();

  return new Promise<IGooglePickedDoc[] | undefined>((resolve) => {
    let settled = false;
    // The settle closure needs the picker before build() has returned it.
    const holder: { picker?: IGooglePicker } = {};
    const settle = (docs: IGooglePickedDoc[] | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(stallTimer);
      holder.picker?.setVisible(false);
      holder.picker?.dispose?.();
      resolve(docs);
    };
    // The picker only fires PICKED/CANCEL; a wedged iframe (e.g. Google's bare
    // 403 page) fires neither and would leave the caller's promise pending
    // forever — with the import dialog unmounted while picking. Treat a long
    // stall as a cancel so the UI always comes back.
    const stallTimer = setTimeout(() => settle(undefined), 5 * 60 * 1000);
    let builder = new pickerApi.PickerBuilder()
      .addView(new pickerApi.DocsView(spreadsheetsViewId))
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setAppId(appId);
    if (multiSelect) {
      builder = builder.enableFeature(pickerApi.Feature.MULTISELECT_ENABLED);
    }
    builder = builder.setCallback((response) => {
      if (response.action === pickerApi.Action.PICKED) {
        const docs = response.docs ?? [];
        settle(docs.length > 0 ? docs : undefined);
      } else if (response.action === pickerApi.Action.CANCEL) {
        settle(undefined);
      }
    });
    if (locale) {
      builder = builder.setLocale(locale);
    }
    holder.picker = builder.build();
    holder.picker.setVisible(true);
  });
};
