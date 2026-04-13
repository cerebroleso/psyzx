using Microsoft.EntityFrameworkCore;
using psyzx.Models;

namespace psyzx.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<User> Users { get; set; } = null!;
    public DbSet<Artist> Artists { get; set; } = null!;
    public DbSet<Album> Albums { get; set; } = null!;
    public DbSet<Track> Tracks { get; set; } = null!;
    
    public DbSet<Playlist> Playlists { get; set; } = null!;
    public DbSet<PlaylistTrack> PlaylistTracks { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<User>().HasIndex(u => u.Username).IsUnique();

        // Configuration for Artist
        modelBuilder.Entity<Artist>(entity =>
        {
            entity.HasIndex(a => a.Name)
                .HasDatabaseName("idx_artist_name")
                .IsFullText(); // Correct extension for Pomelo

            entity.HasMany(a => a.Albums)
                .WithOne(al => al.Artist)
                .HasForeignKey(al => al.ArtistId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Configuration for Album
        modelBuilder.Entity<Album>(entity =>
        {
            entity.HasIndex(a => a.Title)
                .HasDatabaseName("idx_album_title")
                .IsFullText();

            entity.HasMany(al => al.Tracks)
                .WithOne(t => t.Album)
                .HasForeignKey(t => t.AlbumId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // Relationships for User and Playlist
        modelBuilder.Entity<User>()
            .HasMany<Playlist>()
            .WithOne(p => p.User)
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Playlist>()
            .HasMany(p => p.PlaylistTracks)
            .WithOne(pt => pt.Playlist)
            .HasForeignKey(pt => pt.PlaylistId)
            .OnDelete(DeleteBehavior.Cascade);
            
        // Configuration for Track
        modelBuilder.Entity<Track>(entity =>
        {
            entity.HasIndex(t => new { t.Title, t.SearchTags })
                .HasDatabaseName("idx_track_search")
                .IsFullText();

            entity.HasMany<PlaylistTrack>()
                .WithOne(pt => pt.Track)
                .HasForeignKey(pt => pt.TrackId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}