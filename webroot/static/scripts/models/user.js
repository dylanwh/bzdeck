/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Define the User Model that represents a Bugzilla user. Available through the UserCollection.
 * @extends BzDeck.BaseModel
 * @see {@link http://bugzilla.readthedocs.org/en/latest/api/core/v1/user.html#get-user}
 */
BzDeck.UserModel = class UserModel extends BzDeck.BaseModel {
  /**
   * Get an UserModel instance.
   * @constructor
   * @argument {Object} data - Profile object including Bugzilla's raw user data.
   * @return {Proxy} user - Proxified UserModel instance, so consumers can seamlessly access user properties via
   *  user.prop instead of user.data.prop.
   */
  constructor (data) {
    super(); // This does nothing but is required before using `this`

    this.datasource = BzDeck.datasources.account;
    this.store_name = 'users';
    this.email = data.name = (data.name || data.bugzilla.name);
    this.hash = md5(this.email);
    this.cache(data);

    // These properties should work even when the user's Bugzilla profile is still being loaded
    Object.defineProperties(this, {
      // This is not the Bugzilla user name (email address) but pretty name.
      // Replace both 'Kohei Yoshino [:Kohei]' and 'Kohei Yoshino :Kohei' with 'Kohei Yoshino'
      name: {
        enumerable: true,
        get: () => this.original_name.replace(/[\[\(<‹].*?[›>\)\]]/g, '').replace(/\:[\w\-]+/g, '').trim()
                        || this.email.split('@')[0]
      },
      // Other name props
      original_name: {
        enumerable: true,
        get: () => this.data.bugzilla ? this.data.bugzilla.real_name || '' : ''
      },
      first_name: {
        enumerable: true,
        get: () => this.name.split(/\s/)[0]
      },
      initial: {
        enumerable: true,
        get: () => this.first_name.charAt(0).toUpperCase()
      },
      nick_names: {
        enumerable: true,
        get: () => (this.original_name.match(/\:[\w\-]+/g) || []).map(name => name.substr(1)) // Consider multiple nick
      },
      // Images provided by Gravatar
      image: {
        enumerable: true,
        get: () => this.data.image_src || ''
      },
      background_image: {
        enumerable: true,
        get: () => { try { return this.data.gravatar.profileBackground.url; } catch (e) { return undefined; }}
      },
      // Find background color from Gravatar profile or generate one based on the user name and email
      color: {
        enumerable: true,
        get: () => { try { return this.data.gravatar.profileBackground.color; } catch (e) {
          return '#' + String(this.original_name ? this.original_name.length : 0).substr(-1, 1)
                     + String(this.email.length).substr(-1, 1)
                     + String(this.email.length).substr(0, 1);
        }}
      },
      // Return basic info for easier fill-in on views
      properties: {
        enumerable: true,
        get: () => ({
          name: this.name,
          givenName: this.first_name,
          alternateName: this.nick_names[0],
          description: this.original_name || this.name,
          email: this.email,
          image: this.image,
        }),
      },
    });

    // Generate the avatar's object URL for this session
    if (this.data.image_blob) {
      this.data.image_src = URL.createObjectURL(this.data.image_blob);
    }

    if (!this.data.updated) {
      this.fetch().then(profiles => {
        // Notify the change to update the UI when necessary
        this.trigger(':UserInfoUpdated', { name: this.email });
      });
    }

    return this.proxy();
  }

  /**
   * Retrieve the user's relevant data from Bugzilla and Gravatar, save the results, and return the profile.
   * @argument {Object} [options] - Extra options.
   * @return {Promise.<Proxy>} data - Promise to be resolved in the user's profile.
   */
  fetch (options = {}) {
    options.in_promise_all = true;

    return Promise.all([
      this.get_bugzilla_profile(options),
      this.get_gravatar_image(options),
      // Refresh the Gravatar profile if already exists, or fetch later on demand
      this.data.gravatar ? this.get_gravatar_profile(options) : Promise.resolve()
    ]).then(results => {
      this.save({
        name: this.email, // String
        id: results[0].id, // Number
        bugzilla: results[0], // Object
        image_blob: results[1], // Blob
        image_src: results[1] ? URL.createObjectURL(results[1]) : undefined, // URL
        gravatar: results[2] || undefined, // Object
        updated: Date.now(), // Number
      });
    }).catch(error => {
      this.save({
        name: this.email,
        error: error.message,
        updated: Date.now(),
      });
    }).then(() => Promise.resolve(this.data));
  }

  /**
   * Get or retrieve the user's Bugzilla profile. The profile may be available at the time of creating the UserModel.
   * @argument {Object} [options] - Extra options.
   * @argument {Boolean} [options.in_promise_all=false] - Whether the function is called as part of Promise.all().
   * @argument {String} [options.api_key] - API key used to authenticate against the Bugzilla API.
   * @return {Promise.<Object>} bug - Promise to be resolved in the user's Bugzilla profile.
   * @see {@link http://bugzilla.readthedocs.org/en/latest/api/core/v1/user.html#get-user}
   */
  get_bugzilla_profile (options = {}) {
    if (this.data.bugzilla && this.data.bugzilla.id) {
      return Promise.resolve(this.data.bugzilla);
    }

    if (this.data.error) {
      return Promise.reject(new Error(this.data.error));
    }

    let params = new URLSearchParams(),
        _options = { api_key: options.api_key || undefined };

    params.append('names', this.email);

    return new Promise((resolve, reject) => {
      BzDeck.host.request('user', params, _options).then(result => {
        result.users ? resolve(result.users[0]) : reject(new Error(result.message || 'User Not Found'));
      }).catch(error => reject(error));
    });
  }

  /**
   * Get or retrieve the user's Gravatar profile. Because the request can be done only through JSONP that requires DOM
   * access, delegate the process to GlobalController.
   * @argument {Object} [options] - Extra options.
   * @argument {Boolean} [options.in_promise_all=false] - Whether the function is called as part of Promise.all().
   * @return {Promise.<Object>} bug - Promise to be resolved in the user's Gravatar profile.
   * @see {@link https://en.gravatar.com/site/implement/profiles/json/}
   */
  get_gravatar_profile (options = {}) {
    if (this.data.gravatar) {
      if (this.data.gravatar.error) {
        return Promise.reject(new Error('The Gravatar profile cannot be found'));
      }

      return Promise.resolve(this.data.gravatar);
    }

    return new Promise((resolve, reject) => {
      this.on('GlobalController:GravatarProfileProvided', data => {
        let { hash, profile } = data;

        if (hash === this.hash) {
          if (profile) {
            resolve(profile);
          } else if (options.in_promise_all) {
            // Resolve anyway if this is called in Promise.all()
            profile = { error: 'Not Found' };
            resolve(profile);
          } else {
            reject(new Error('The Gravatar profile cannot be found'));
          }

          // Save the profile when called by UserCollection
          if (!options.in_promise_all) {
            this.data.gravatar = profile;
            this.save();
          }
        }
      });

      this.trigger(':GravatarProfileRequested', { hash: this.hash });
    });
  }

  /**
   * Get or retrieve the user's Gravatar image. If the image cannot be found, generate a fallback image and return it.
   * Because this requires DOM access, delegate the process to GlobalController.
   * @argument {Object} [options] - Extra options.
   * @return {Promise.<Blob>} bug - Promise to be resolved in the user's avatar image in the Blob format.
   * @see {@link https://en.gravatar.com/site/implement/images/}
   */
  get_gravatar_image (options = {}) {
    if (this.data.image_blob) {
      return Promise.resolve(this.data.image_blob);
    }

    return new Promise(resolve => {
      let { hash, color, initial } = this;

      this.on('GlobalController:GravatarImageProvided', data => {
        if (data.hash === hash) {
          resolve(data.blob);

          // Save the image when called by UserCollection
          if (!options.in_promise_all) {
            this.data.image_blob = data.blob;
            this.data.image_src = URL.createObjectURL(data.blob);
            this.save();
          }
        }
      });

      this.trigger(':GravatarImageRequested', { hash, color, initial });
    });
  }
}
