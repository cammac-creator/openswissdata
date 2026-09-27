/** Le menu mobile est un dépliage de navigation, sans dialogue ni piège de focus. */
export function bindAdminNavigation(section:()=>string) {
  const sidebar = document.getElementById('sidebar')!;
  const navigation = document.getElementById('workspace-navigation')!;
  const dismiss = document.getElementById('spaces-dismiss')!;
  const buttons = ['spaces-toggle','spaces-more'].map(id=>document.getElementById(id) as HTMLButtonElement);
  const mobile = window.matchMedia('(max-width:800px)');
  let openedBy:HTMLButtonElement|undefined;
  function close(restoreFocus=false) {
    sidebar.removeAttribute('data-open');
    buttons.forEach(button=>button.setAttribute('aria-expanded','false'));
    if(restoreFocus && openedBy?.getClientRects().length) openedBy.focus();
  }
  buttons.forEach(button=>button.addEventListener('click',()=>{
    if(sidebar.dataset.open==='true') {close(true);return;}
    openedBy=button;sidebar.dataset.open='true';
    buttons.forEach(control=>control.setAttribute('aria-expanded','true'));
    // Depuis le bas de l’écran, placer le clavier dans le menu devenu visible.
    if(button.id==='spaces-more') (navigation.querySelector<HTMLAnchorElement>('[aria-current=page]') ?? navigation.querySelector<HTMLAnchorElement>('a'))?.focus();
  }));
  dismiss.addEventListener('click',()=>close(true));
  navigation.querySelectorAll<HTMLAnchorElement>('a[data-nav]').forEach(link=>link.addEventListener('click',()=>{
    close();
    if(link.dataset.nav===section()) {
      const title=document.getElementById('page-title');
      title?.focus({preventScroll:true});title?.scrollIntoView({block:'start'});
    }
  }));
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && sidebar.dataset.open==='true') {event.preventDefault();close(true);}
  });
  document.addEventListener('pointerdown',event=>{
    const target=event.target;
    // Garder le voile jusqu’au clic évite qu’un toucher active le contenu découvert.
    if(target instanceof Node && dismiss.contains(target)) return;
    if(target instanceof Node && !sidebar.contains(target) && !buttons.some(button=>button.contains(target))) close();
  });
  document.addEventListener('focusin',event=>{
    const target=event.target;
    if(target instanceof Node && !dismiss.contains(target) && !sidebar.contains(target) && !buttons.some(button=>button.contains(target))) close();
  });
  mobile.addEventListener('change',()=>close());
  return ()=>{
    close();
    buttons[1].dataset.active=String(!['overview','clients','mail'].includes(section()));
  };
}
