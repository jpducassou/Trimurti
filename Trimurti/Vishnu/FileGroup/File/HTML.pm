package Trimurti::Vishnu::FileGroup::File::HTML;

# ============================================================================
# Handles configuration 
# ============================================================================
use strict;
use warnings;
use Carp qw( croak );

use Template;
use Template::Provider;
use Template::Parser;
use Template::Stash;

# ============================================================================
require Exporter;
use vars qw($VERSION @ISA @EXPORT);

@ISA = qw(Exporter);
@EXPORT = qw(process);

# ============================================================================
sub vishnu {
	my ( $stash ) = @_;
	
	my $tt_stash = Template::Stash->new();
	$tt_stash->{VISHNU} = $stash;
	
	my $tt = Template->new({
			PRE_CHOMP  => 1,
			POST_CHOMP => 1,
			TAG_STYLE => 'html',
			ENCODING => 'utf8', #force utf8 encoding for templates
			STASH => $tt_stash,
			LOAD_TEMPLATES => [ Template::Provider->new( INCLUDE_PATH => $stash->{PROJECT}->{BASE} ) ],
			PLUGIN_BASE => [
											'Trimurti::Vishnu::FileGroup::File::HTML::Filter',
											'Trimurti::Vishnu::FileGroup::File::HTML::Plugin',
										 ],
			#PLUGINS => {
			#	script => 'Trimurti::Vishnu::FileGroup::File::HTML::Filter::ScriptTag',
			#	
			#},
			PREFIX_MAP => {
        file    => '0',     # file:foo.html
        #http    => '1',     # http:foo.html
        default => '0',     # foo.html => file:foo.html
			},
			OUTPUT => $stash->{THIS}->{FILE}->{DESTINATION_PATH},
			OUTPUT_PATH => $stash->{THIS}->{FILE_GROUP}->{DESTINATION},
	});
	
	$tt->process(
		$stash->{THIS}->{FILE}->{SOURCE_PATH},
		$stash->{THIS},
	) || croak( $tt->error() . ' processing ' . $stash->{THIS}->{FILE}->{SOURCE_PATH} );
}

1;