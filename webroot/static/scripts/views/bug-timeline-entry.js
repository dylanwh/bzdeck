/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Define the Bug Timeline Entry View that represents each entry on the Bug Timeline: such as a comment,
 * comment+attachment, comment+attachment+change(s) or only change(s).
 * @extends BzDeck.BaseView
 */
BzDeck.BugTimelineEntryView = class BugTimelineEntryView extends BzDeck.BaseView {
  /**
   * Get a BugTimelineEntryView instance.
   * @constructor
   * @argument {String} view_id - Instance identifier. It should be the same as the BugController instance, otherwise
   *  the relevant notification events won't work.
   * @argument {Proxy} bug - Proxified BugModel instance.
   * @argument {Map.<String, Object>} data - Prepared entry data including the comment, attachment and history (change)
   *  if any.
   * @return {DocumentFragment} $fragment - Generated entry node in a fragment.
   */
  constructor(view_id, bug, data) {
    super(); // This does nothing but is required before using `this`

    this.id = view_id;
    this.bug = bug;
    this.data = data;
  }

  /**
   * Create a timeline entry.
   * @argument {undefined}
   * @return {Promise.<Object>} entry - Promise to be resolved in an object containing the entry fragment and timestamp.
   */
  create () {
    let comment = this.data.get('comment'),
        $fragment = new DocumentFragment();

    return new Promise(resolve => {
      if (!comment) {
        resolve();
        return;
      }

      let dup = comment.text.match(/(?:Bug (\d+))? has been marked as a duplicate of (?:Bug (\d+))?\.?/i);

      if (!dup || !dup[1]) {
        this.create_comment_entry().then($entry => {
          let $comment = $fragment.appendChild($entry);

          if (this.data.get('attachment')) {
            return this.create_attachment_box().then($attachment => $comment.appendChild($attachment));
          }

          return Promise.resolve();
        }).then(() => resolve());
      }

      if (dup) {
        // Treat duplication comments like history items
        this.create_history_entry(comment.creator, comment.creation_time, {
          field_name: dup[1] ? 'duplicates' : 'dupe_of',
          added: dup[1] || dup[2],
          removed: '',
        }, comment).then($change => $fragment.appendChild($change)).then(() => resolve());
      }
    }).then(() => {
      if (this.data.get('history')) {
        return this.create_history_entries().then($f => $fragment.appendChild($f));
      }

      return Promise.resolve();
    }).then(() => {
      return { $outer: $fragment, time: this.data.get('time') };
    });
  }

  /**
   * Create a comment entry that contains the author name/image, timestamp, comment body and Reply button.
   * @argument {undefined}
   * @return {Promise.<HTMLElement>} $entry - Promise to be resolved in the generated entry node.
   */
  create_comment_entry () {
    let click_event_type = this.helpers.env.touch.enabled ? 'touchstart' : 'mousedown',
        comment = this.data.get('comment'),
        time = comment.creation_time,
        text = comment.raw_text,
        $entry = this.get_template('timeline-comment'),
        $header = $entry.querySelector('header'),
        $author = $entry.querySelector('[itemprop="author"]'),
        $roles = $author.querySelector('.roles'),
        $time = $entry.querySelector('[itemprop="creation_time"]'),
        $reply_button = $entry.querySelector('[data-command="reply"]'),
        $comment_body = $entry.querySelector('[itemprop="text"]'),
        $textbox = document.querySelector(`#${this.id}-comment-form [role="textbox"]`);

    comment.number = this.data.get('comment_number');
    $entry.id = `${this.id}-comment-${comment.id}`;
    $entry.dataset.id = comment.id;
    $entry.dataset.time = (new Date(time)).getTime();
    $entry.setAttribute('data-comment-number', comment.number);
    $entry.querySelector(':not([itemscope]) > [itemprop="name"]').textContent = `Comment ${comment.number}`; // l10n
    $comment_body.innerHTML = text ? BzDeck.controllers.global.parse_comment(text) : '';

    return BzDeck.collections.users.get(comment.creator, { name: comment.creator }).then(author => {
      // Append the comment number to the URL when clicked
      $entry.addEventListener(click_event_type, event => {
        if (!event.target.matches(':-moz-any-link')) {
          this.trigger('BugView:CommentSelected', { number: Number(comment.number) });
        }
      });

      let reply = () => {
        let quote_header = `(In reply to ${author.name} from comment #${comment.number})`,
            quote_lines = (text.match(/^$|.{1,78}(?:\b|$)/gm) || []).map(line => `> ${line}`),
            quote = `${quote_header}\n${quote_lines.join('\n')}`,
            $tabpanel = document.querySelector(`#${this.id}-comment-form-tabpanel-comment`),
            $textbox = document.querySelector(`#${this.id}-comment-form [role="textbox"]`);

        $textbox.value += `${$textbox.value ? '\n\n' : ''}${quote}\n\n`;
        // Move focus on the textbox. Use async to make sure the event always works
        this.helpers.event.async(() => $textbox.focus());
        // Trigger an event to do something. Disable async to make sure the following lines work
        this.helpers.event.trigger($textbox, 'input', {}, false);
        // Scroll to make sure the comment is visible
        $tabpanel.scrollTop = $tabpanel.scrollHeight;
        $entry.scrollIntoView({ block: 'start', behavior: 'smooth' });
      };

      // Collapse/expand the comment
      let collapse_comment = () => {
        $entry.setAttribute('aria-expanded', $entry.getAttribute('aria-expanded') === 'false');
      };

      // Focus management
      let move_focus = shift => {
        BzDeck.prefs.get('ui.timeline.sort.order').then(order => {
          let ascending = order !== 'descending',
              entries = [...document.querySelectorAll(`#${this.id}-timeline [itemprop="comment"]`)];

          if (!$entry.matches(':focus')) {
            $entry.focus();
            $entry.scrollIntoView({ block: ascending ? 'start' : 'end', behavior: 'smooth' });

            return;
          }

          entries = ascending && shift || !ascending && !shift ? entries.reverse() : entries;
          entries = entries.slice(entries.indexOf($entry) + 1);

          // Focus the next (or previous) visible entry
          for (let $_entry of entries) if ($_entry.clientHeight) {
            $_entry.focus();
            $_entry.scrollIntoView({ block: ascending ? 'start' : 'end', behavior: 'smooth' });

            break;
          }
        });
      };

      // Activate the buttons
      $reply_button.addEventListener(click_event_type, event => { reply(); event.stopPropagation(); });

      // Assign keyboard shortcuts
      this.helpers.kbd.assign($entry, {
        R: event => reply(),
        // Collapse/expand the comment
        C: event => collapse_comment(),
        // Focus management
        'ArrowUp|PageUp|Shift+Space': event => move_focus(true),
        'ArrowDown|PageDown|Space': event => move_focus(false),
      });

      // The author's role(s)
      {
        let roles = new Set();

        if (author.email === this.bug.creator) {
          roles.add('Reporter'); // l10n
        }

        if (author.email === this.bug.assigned_to) {
          roles.add('Assignee'); // l10n
        }

        if (this.bug.mentors.includes(author.email)) {
          roles.add('Mentor'); // l10n
        }

        if (author.email === this.bug.qa_contact) {
          roles.add('QA'); // l10n
        }

        for (let role of roles) {
          let $role = document.createElement('span');

          $role.setAttribute('itemprop', 'role'); // Not in Schema.org
          $role.textContent = role;
          $roles.appendChild($role);
        }
      }

      $author.title = `${author.original_name || author.name}\n${author.email}`;
      $author.querySelector('[itemprop="name"]').textContent = author.name;
      $author.querySelector('[itemprop="email"]').content = author.email;
      $author.querySelector('[itemprop="image"]').src = author.image;
      this.helpers.datetime.fill_element($time, time);

      // Mark unread
      $entry.setAttribute('data-unread', 'true');

      // Click the header to collapse/expand the comment
      // TODO: Save the state in DB
      $entry.setAttribute('aria-expanded', 'true');
      $header.addEventListener(click_event_type, event => {
        if (event.target === $header) {
          collapse_comment();
        }
      });

      return $entry;
    });
  }

  /**
   * Create an Attachment box that will be added to the entry node.
   * @argument {undefined}
   * @return {Promise.<HTMLElement>} $attachment - Promise to be resolved in the rendered attachment item.
   */
  create_attachment_box () {
    return BzDeck.collections.attachments.get(this.data.get('attachment').id).then(attachment => {
      let media_type = attachment.content_type.split('/')[0],
          $attachment = this.get_template('timeline-attachment'),
          $outer = $attachment.querySelector('div'),
          $media;

      this.fill($attachment, {
        summary: attachment.summary,
        content_type: attachment.content_type,
        is_patch: !!attachment.is_patch,
      }, {
        'data-att-id': attachment.id,
      });

      $attachment.title = [
        attachment.summary,
        attachment.file_name,
        attachment.is_patch ? 'Patch' : attachment.content_type, // l10n
        `${(attachment.size / 1024).toFixed(2)} KB` // l10n
      ].join('\n');

      if (media_type === 'image') {
        $media = document.createElement('img');
        $media.alt = attachment.summary;
      }

      if (media_type === 'audio' || media_type === 'video') {
        $media = document.createElement(media_type);
        $media.controls = true;

        if ($media.canPlayType(attachment.content_type) === '') {
          $media = null; // Cannot play the media
        }
      }

      if ($media) {
        $outer.appendChild($media);

        BzDeck.prefs.get('ui.timeline.display_attachments_inline').then(display_inline => {
          if (display_inline !== false) {
            $outer.setAttribute('aria-busy', 'true');

            attachment.get_data().then(result => {
              $media.src = URL.createObjectURL(result.blob);
              attachment.data = result.attachment.data;
            }).then(() => {
              $outer.removeAttribute('aria-busy');
            });
          }
        });
      } else {
        // TODO: support other attachment types
        $outer.remove();
      }

      return $attachment;
    });
  }

  /**
   * Create history entries that show any changes to the bug.
   * @argument {undefined}
   * @return {Promise.<DocumentFragment>} $fragment - Promise to be resolved in generated entries in a fragment.
   */
  create_history_entries () {
    let comment = this.data.get('comment'),
        history = this.data.get('history'),
        changes = history.changes.filter(change => !['is_confirmed', 'cf_last_resolved'].includes(change.field_name)),
        changer_name = history.who,
        time = history.when,
        $fragment = new DocumentFragment();

    return Promise.all(changes.map(change => {
      return this.create_history_entry(changer_name, time, change, comment)
          .then($change => $fragment.appendChild($change));
    })).then(() => {
      return $fragment;
    });
  }

  /**
   * Create a history entry that shows a change to the bug.
   * @argument {String} changer_name - Account name of the person who made the change.
   * @argument {String} time - Timestamp of the change.
   * @argument {Object} change - Change details.
   * @argument {undefined} [comment] - Comment posted at the same time as the change, if any.
   * @return {Promise.<HTMLElement>} $change - Promise to be resolved in the rendered change item.
   * @see {@link http://bugzilla.readthedocs.org/en/latest/api/core/v1/bug.html#bug-history}
   */
  create_history_entry (changer_name, time, change, comment) {
    let $change = this.get_template('timeline-change'),
        $changer = $change.querySelector('[itemprop="author"]'),
        $time = $change.querySelector('[itemprop="creation_time"]'),
        $how = $change.querySelector('[itemprop="how"]'),
        conf_field = BzDeck.host.data.config.field,
        _field = conf_field[change.field_name] ||
                 // Bug 909055 - Field name mismatch in history: group vs groups
                 conf_field[change.field_name.replace(/s$/, '')] ||
                 // Bug 1078009 - Changes/history now include some wrong field names
                 conf_field[{
                   'flagtypes.name': 'flag',
                   'attachments.description': 'attachment.description',
                   'attachments.filename': 'attachment.file_name',
                   'attachments.ispatch': 'attachment.is_patch',
                   'attachments.isobsolete': 'attachment.is_obsolete',
                   'attachments.isprivate': 'attachment.is_private',
                   'attachments.mimetype': 'attachment.content_type',
                   'duplicates': 'duplicates', // for duplication comments
                   'dupe_of': 'dupe_of', // for duplication comments
                 }[change.field_name]] ||
                 // If the Bugzilla config is outdated, the field name can be null
                 change,
        _field_label = {
          blocks: 'blockers', // l10n
          depends_on: 'dependencies', // l10n
          duplicates: 'duplicates', // for duplication comments, unused
          dupe_of: 'dupe_of', // for duplication comments, unused
        }[change.field_name] || _field.description || _field.field_name,
        field = `<span data-what="${change.field_name}">` + _field_label + '</span>';

    if (change.field_name.startsWith('cf_')) {
      field += ' flag'; // l10n
    }

    return BzDeck.collections.users.get(changer_name, { name: changer_name }).then(changer => {
      this.fill($changer, changer.properties, {
        title: `${changer.original_name || changer.name}\n${changer.email}`
      });

      $change.setAttribute('data-change-field', change.field_name);
      this.helpers.datetime.fill_element($time, time);

      let _reviews = { added: new Set(), removed: new Set() },
          _feedbacks = { added: new Set(), removed: new Set() },
          _needinfos = { added: new Set(), removed: new Set() };

      let find_people = how => {
        for (let item of change[how].split(', ')) {
          let review = item.match(/^review\?\((.*)\)$/),
              feedback = item.match(/^feedback\?\((.*)\)$/),
              needinfo = item.match(/^needinfo\?\((.*)\)$/);

          if (review) {
            _reviews[how].add(review[1]);
          }

          if (feedback) {
            _feedbacks[how].add(feedback[1]);
          }

          if (needinfo) {
            _needinfos[how].add(needinfo[1]);
          }
        }
      };

      find_people('added');
      find_people('removed');

      let reviews,
          added_reviews = _reviews.added.size ? this.create_people_array(_reviews.added) : undefined,
          removed_reviews = _reviews.removed.size ? this.create_people_array(_reviews.removed) : undefined,
          feedbacks,
          added_feedbacks = _feedbacks.added.size ? this.create_people_array(_feedbacks.added) : undefined,
          removed_feedbacks = _feedbacks.removed.size ? this.create_people_array(_feedbacks.removed) : undefined,
          needinfos,
          added_needinfos = _needinfos.added.size ? this.create_people_array(_needinfos.added) : undefined,
          removed_needinfos = _needinfos.removed.size ? this.create_people_array(_needinfos.removed) : undefined,
          get_removals = change.removed ?
              this.create_history_change_element(change, 'removed').then($elm => $elm.outerHTML) : undefined,
          get_additions = change.added ?
              this.create_history_change_element(change, 'added').then($elm => $elm.outerHTML) : undefined,
          render = str => $how.innerHTML = str,
          att_id = change.attachment_id,
          attachment = att_id ? `<a href="/attachment/${att_id}" data-att-id="${att_id}">Attachment ${att_id}</a>`
                              : undefined; // l10n

      // Addition only
      if (!change.removed && change.added) {
        if (_reviews.added.size && att_id) {
          added_reviews.then(reviews => render(`asked ${reviews} to review ${attachment}`)); // l10n
        } else if (_feedbacks.added.size && att_id) {
          added_feedbacks.then(feedbacks =>
              render(`asked ${feedbacks} for feedback on ${attachment}`)); // l10n
        } else if (_needinfos.added.size) {
          added_needinfos.then(needinfos => render(`asked ${needinfos} for information`)); // l10n
        } else if (att_id && change.added === 'review+') {
          render(`approved ${attachment}`); // l10n
        } else if (att_id && change.added === 'review-') {
          render(`rejected ${attachment}`); // l10n
        } else if (att_id && change.added === 'feedback+') {
          render(`gave positive feedback on ${attachment}`); // l10n
        } else if (att_id && change.added === 'feedback-') {
          render(`gave negative feedback on ${attachment}`); // l10n
        } else if (att_id && change.field_name === 'flagtypes.name') {
          get_additions.then(additions => render(`set ${additions} flag to ${attachment}`)); // l10n
        } else if (change.field_name === 'duplicates') {
          // for duplication comments, l10n
          get_additions.then(additions => render(`marked ${additions} as a duplicate of this bug`));
        } else if (change.field_name === 'dupe_of') {
          // for duplication comments, l10n
          get_additions.then(additions => render(`marked this bug as a duplicate of ${additions}`));
        } else if (change.field_name === 'keywords') {
          if (change.added.split(', ').length === 1) {
            get_additions.then(additions => render(`added ${additions} keyword`)); // l10n
          } else {
            get_additions.then(additions => render(`added ${additions} keywords`)); // l10n
          }
        } else if (change.field_name === 'cc' && change.added === changer.email) {
          render(`subscribed to the bug`); // l10n
        } else if (change.field_name === 'status' && change.added === 'REOPENED') {
          render(`reopened the bug`); // l10n
        } else if (change.field_name === 'resolution' && change.added === 'FIXED') {
          render(`marked the bug <strong>${change.added}</strong>`); // l10n
        } else {
          get_additions.then(additions => render(`added ${additions} to ${field}`)); // l10n
        }
      }

      // Removal only
      if (change.removed && !change.added) {
        if (att_id && _reviews.removed.size) {
          removed_reviews.then(reviews => render(`canceled ${attachment} review by ${reviews}`)); // l10n
        } else if (att_id && _feedbacks.removed.size) {
          removed_feedbacks.then(feedbacks =>
              render(`canceled ${attachment} feedback by ${feedbacks}`)); // l10n
        } else if (_needinfos.removed.size) {
          removed_needinfos.then(needinfos => {
            if (!comment) {
              render(`canceled information request from ${needinfos}`); // l10n
            } else if (_needinfos.removed.size === 1 && _needinfos.removed.has(changer.email)) {
              render(`provided information`); // l10n
            } else {
              render(`provided information on behalf of ${needinfos}`); // l10n
            }
          });
        } else if (att_id && change.field_name === 'flagtypes.name') {
          get_removals.then(removals => render(`removed ${removals} flag from ${attachment}`)); // l10n
        } else if (change.field_name === 'keywords') {
          if (change.removed.split(', ').length === 1) {
            get_removals.then(removals => render(`removed ${removals} keyword`)); // l10n
          } else {
            get_removals.then(removals => render(`removed ${removals} keywords`)); // l10n
          }
        } else if (change.field_name === 'cc' && change.removed === changer.email) {
          render(`unsubscribed from the bug`); // l10n
        } else {
          get_removals.then(removals => render(`removed ${removals} from ${field}`)); // l10n
        }
      }

      // Removal + Addition
      if (change.removed && change.added) {
        if ((['priority', 'target_milestone'].includes(change.field_name) || change.field_name.startsWith('cf_')) &&
            change.removed.startsWith('--')) {
          get_additions.then(additions => render(`set ${field} to ${additions}`)); // l10n
        } else if (att_id && change.added === 'review+' && _reviews.removed.size) {
          if (_reviews.removed.size === 1 && _reviews.removed.has(changer.email)) {
            render(`approved ${attachment}`); // l10n
          } else {
            removed_reviews.then(reviews => render(`approved ${attachment} on behalf of ${reviews}`)); // l10n
          }
        } else if (att_id && change.added === 'review-' && _reviews.removed.size) {
          if (_reviews.removed.size === 1 && _reviews.removed.has(changer.email)) {
            render(`rejected ${attachment}`); // l10n
          } else {
            removed_reviews.then(reviews => render(`rejected ${attachment} on behalf of ${reviews}`)); // l10n
          }
        } else if (att_id && _reviews.removed.size) {
          Promise.all([added_reviews, removed_reviews]).then(reviews =>
              render(`changed ${attachment} reviewer from ${reviews[0] || 'nobody'} to ${reviews[1] || 'nobody'}`));
        } else if (att_id && change.added === 'feedback+' && _feedbacks.removed.size) {
          if (_feedbacks.removed.size === 1 && _feedbacks.removed.has(changer.email)) {
            render(`gave positive feedback on ${attachment}`); // l10n
          } else {
            removed_feedbacks.then(feedbacks =>
                render(`gave positive feedback on ${attachment} on behalf of ${feedbacks}`)); // l10n
          }
        } else if (att_id && change.added === 'feedback-' && _feedbacks.removed.size) {
          if (_feedbacks.removed.size === 1 && _feedbacks.removed.has(changer.email)) {
            render(`gave negative feedback on ${attachment}`); // l10n
          } else {
            removed_feedbacks.then(feedbacks =>
                render(`gave negative feedback on ${attachment} on behalf of ${feedbacks}`)); // l10n
          }
        } else if (att_id && change.field_name === 'flagtypes.name') {
          Promise.all([get_removals, get_additions]).then(changes =>
              render(`changed ${attachment} flag: ${changes[0]} → ${changes[1]}`)); // l10n
        } else if (change.field_name.match(/^attachments?\.description$/)) {
          Promise.all([get_removals, get_additions]).then(changes =>
              render(`changed ${attachment} description: ${changes[0]} → ${changes[1]}`)); // l10n
        } else if (change.field_name.match(/^attachments?\.file_?name$/)) {
          Promise.all([get_removals, get_additions]).then(changes =>
              render(`changed ${attachment} filename: ${changes[0]} → ${changes[1]}`)); // l10n
        } else if (change.field_name.match(/^attachments?\.is_?patch$/)) {
          if (change.added === '1') {
            render(`marked ${attachment} as patch`); // l10n
          } else {
            render(`unmarked ${attachment} as patch`); // l10n
          }
        } else if (change.field_name.match(/^attachments?\.is_?obsolete$/)) {
          if (change.added === '1') {
            render(`marked ${attachment} as obsolete`); // l10n
          } else {
            render(`unmarked ${attachment} as obsolete`); // l10n
          }
        } else if (_needinfos.removed.size) {
          Promise.all([added_needinfos, removed_needinfos]).then(needinfos =>
              render(`asked ${needinfos[0]} for information instead of ${needinfos[1]}`)); // l10n
        } else if (change.field_name === 'assigned_to' && change.removed.match(/^(nobody@.+|.+@bugzilla\.bugs)$/)) {
          // TODO: nobody@mozilla.org and *@bugzilla.bugs are the default assignees on BMO. It might be different on
          // other Bugzilla instances. The API should provide the info...
          if (change.added === changer.email) {
            render(`self-assigned to the bug`); // l10n
          } else {
            get_additions.then(additions => render(`assigned ${additions} to the bug`)); // l10n
          }
        } else if (change.field_name === 'assigned_to' && change.added.match(/^(nobody@.+|.+@bugzilla\.bugs)$/)) {
          get_removals.then(removals => render(`removed ${removals} from the assignee`)); // l10n
        } else if (change.field_name === 'keywords') {
          Promise.all([get_removals, get_additions]).then(changes =>
              render(`changed the keywords: removed ${changes[0]}, added ${changes[1]}`)); // l10n
        } else if (change.field_name === 'blocks') {
          Promise.all([get_removals, get_additions]).then(changes =>
              render(`changed the blockers: removed ${changes[0]}, added ${changes[1]}`)); // l10n
        } else if (change.field_name === 'depends_on') {
          Promise.all([get_removals, get_additions]).then(changes =>
              render(`changed the dependencies: removed ${changes[0]}, added ${changes[1]}`)); // l10n
        } else {
          Promise.all([get_removals, get_additions]).then(changes =>
              render(`changed ${field}: ${changes[0]} → ${changes[1]}`)); // l10n
        }
      }

      return $change;
    });
  }

  /**
   * Render one or more users in a pretty way, showing the avatar and real name and joining with a comma and "and".
   * @argument {Set.<String>} set - List of user account names.
   * @return {Promise.<String>} str - Promise to be resolved in the rendered HTML string.
   */
  create_people_array (set) {
    return Promise.all([...set].map(name => BzDeck.collections.users.get(name, { name }))).then(people => {
      return people.map(person => {
        let $person = this.get_template('person-with-image');

        this.fill($person, person.properties, { title: `${person.original_name || person.name}\n${person.email}` });

        return $person.outerHTML;
      });
    }).then(array => {
      let last = array.pop();
      return array.length ? array.join(', ') + ' and ' + last : last; // l10n
    });
  }

  /**
   * Render a history change in a pretty way, converting Bug IDs to in-app links.
   * @argument {Object} change - Change details.
   * @argument {String} how - How the change was made: 'added' or 'removed'.
   * @return {Promise.<HTMLElement>} $elm - Promise to be resolved in a rendered element.
   */
  create_history_change_element (change, how) {
    let $elm = document.createElement('span'),
        render = str => $elm.innerHTML = str,
        ids;

    $elm.setAttribute('data-how', how);

    if (['assigned_to', 'qa_contact', 'mentors', 'cc'].includes(change.field_name)) {
      return this.create_people_array(change[how].split(', ')).then(array => {
        render(array);
      }).then(() => $elm);
    } else if (['blocks', 'depends_on', 'duplicates', 'dupe_of'].includes(change.field_name)) {
      if (change[how].split(', ').length > 1) {
        render('Bug ' + change[how].replace(/(\d+)/g, '<a href="/bug/$1" data-bug-id="$1">$1</a>')); // l10n
      } else {
        render(change[how].replace(/(\d+)/g, '<a href="/bug/$1" data-bug-id="$1">Bug $1</a>')); // l10n
      }
    } else if (change.field_name === 'url') {
      render(`<a href="${change[how]}">${change[how]}</a>`);
    } else if (change.field_name === 'see_also') {
      render(change[how].split(', ').map(url => {
        let prefix = BzDeck.host.origin + '/show_bug.cgi?id=',
            bug_id = url.startsWith(prefix) ? Number(url.substr(prefix.length)) : undefined;

        if (bug_id) {
          return `<a href="/bug/${bug_id}" data-bug-id="${bug_id}">Bug ${bug_id}</a>`;
        }

        return `<a href="${url}">${url}</a>`;
      }).join(', '));
    } else {
      render(this.helpers.array.join(change[how].split(', '), how === 'added' ? 'strong' : 'span'));
    }

    return Promise.resolve($elm);
  }
}
