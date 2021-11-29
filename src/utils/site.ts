import { SiteMetadata } from '../types';
import { incompatibleSites } from './constants/incompatibleSites';

/**
 * Extracts the site name from the DOM
 *
 */
const getName = (): string => {
    const { document } = window;

    const siteName: HTMLMetaElement | null = document.querySelector(
        'head > meta[property="og:site_name"]'
    );

    if (siteName) {
        return siteName.content;
    }

    const metaTitle: HTMLMetaElement | null = document.querySelector(
        'head > meta[name="title"]'
    );

    if (metaTitle) {
        return metaTitle.content;
    }

    if (document.title && document.title.length > 0) {
        return document.title;
    }

    return window.location.hostname;
};

/**
 * Extracts an icon for the site from the DOM
 *
 * @returns the icon URL
 */
const getIconFromDom = async (): Promise<string | null> => {
    const { document } = window;

    const icons: NodeListOf<HTMLLinkElement> = document.querySelectorAll(
        'head > link[rel~="icon"]'
    );

    for (const icon of icons) {
        if (icon && (await imgExists(icon.href))) {
            return icon.href;
        }
    }

    return null;
};

/**
 * Returns whether the given image URL exists
 *
 * @param url - the image url
 */
const imgExists = (url: string): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        try {
            const img = document.createElement('img');
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = url;
        } catch (error) {
            reject(error);
        }
    });
};

/**
 * Check for unallowed file extension
 */
const checkExtension = (): boolean => {
    const fileExtensions = [/\.xml$/u, /\.pdf$/u];

    for (let i = 0; i < fileExtensions.length; i++) {
        if (fileExtensions[i].test(window.location.pathname)) {
            return false;
        }
    }

    return true;
};

/**
 * Checks the documentElement of the current document
 */
const documentElementCheck = (): boolean => {
    const documentElement = window.document.documentElement.nodeName;

    if (documentElement) {
        return documentElement.toLowerCase() === 'html';
    }

    return true;
};

/**
 * Checks the doctype of the current document if it exists
 */
const checkDocType = (): boolean => {
    const { doctype } = window.document;

    if (doctype) {
        return doctype.name === 'html';
    }

    return true;
};

/**
 * Helper function with checks to do before loading the script
 */
export const checkScriptLoad = (): boolean => {
    return checkDocType() && checkExtension() && documentElementCheck();
};

/**
 * Returns site metadata
 *
 */
export const getSiteMetadata = async (): Promise<SiteMetadata> => {
    const iconURL = await getIconFromDom();

    return {
        iconURL,
        name: getName(),
    };
};

// Check if the site is on the list of incompatibleSites
export const isCompatible = (): boolean => {
    for (let i = 0; i < incompatibleSites.length; i++) {
        if (incompatibleSites[i] === window.location.hostname) {
            return false;
        }
    }
    return true;
};
