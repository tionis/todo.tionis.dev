- [x] fix list member email in share modal on todo list page
      the share modal shows the email of invited users as long as it's still an invite
      as soon as they are members only "Unknown User" is shown. I think this might be related to the query not following the link correctly
- [x] fix invitedBy email field in invitation on invitation page
      this might be a similar issue as the one with the member emails. Invites only show 'Invited by: Unknown'. This is also a link to a user entity and thus might be related
- [x] fix dark mode toggle 
      the toggle in the top right doesn't correctly switch the themes, even though changing system mode works
      the toggle only changes some text from dark to light
- [ ] mobile improvements
  - [ ] The drop down selection menu for the category in the quick add feature. The drop down menu gets too large horizontally and is too long on the right side, thus destroying the layout.
  - [ ] the buttons at the top are taking up too much screen real estate due to them having to be shown in multiple rows, perhaps a small 3 line symbol menu would be better here?
- [x] add some kind of setting to transfer ownership of a list to another user
      this might need some kind of logging or invite system to see where the list came from
- [x] fix routing when compiling to static website (use client-side routing?)
      `/[slug]` routes are used to identify todo lists. This means that some client-side routing is needed here as we want to deploy the app as a static webapp
